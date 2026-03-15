import express from 'express';
import SystemConfig from '../models/SystemConfig.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { restartAutomationJobs } from '../services/automationScheduler.js';
import { generateMonthlyRent } from '../services/rentGenerationService.js';
import { calculateLateFees } from '../services/lateFeeService.js';

const router = express.Router();

// Get system configuration
router.get('/', authenticate, async (req, res) => {
  try {
    const config = await SystemConfig.getConfig();
    res.json(config);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Update system configuration (superadmin only)
router.put('/', authenticate, authorize('superadmin'), async (req, res) => {
  try {
    let config = await SystemConfig.findOne();
    if (!config) {
      config = new SystemConfig(req.body);
    } else {
      Object.assign(config, req.body);
    }
    await config.save();
    
    // Restart automation jobs if automation settings changed
    if (req.body.automation) {
      try {
        await restartAutomationJobs();
      } catch (error) {
        console.error('Error restarting automation jobs:', error);
        // Don't fail the request if automation restart fails
      }
    }
    
    res.json(config);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Get automation settings
router.get('/automation', authenticate, authorize('superadmin'), async (req, res) => {
  try {
    const config = await SystemConfig.getConfig();
    res.json({
      rentGeneration: config.automation?.rentGeneration || {
        enabled: false,
        dayOfMonth: 1,
        time: '00:00',
        lastGenerated: null
      },
      lateFee: config.automation?.lateFee || {
        enabled: false,
        gracePeriodDays: 5,
        calculationMethod: 'percentage',
        percentage: 5,
        fixedAmount: 0,
        checkFrequency: 'daily'
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Update automation settings
router.put('/automation', authenticate, authorize('superadmin'), async (req, res) => {
  try {
    const config = await SystemConfig.getConfig();
    
    if (!config.automation) {
      config.automation = {};
    }
    
    if (req.body.rentGeneration) {
      config.automation.rentGeneration = {
        ...config.automation.rentGeneration,
        ...req.body.rentGeneration
      };
    }
    
    if (req.body.lateFee) {
      config.automation.lateFee = {
        ...config.automation.lateFee,
        ...req.body.lateFee
      };
    }
    
    await config.save();
    
    // Restart automation jobs with new settings
    try {
      await restartAutomationJobs();
    } catch (error) {
      console.error('Error restarting automation jobs:', error);
    }
    
    res.json({
      rentGeneration: config.automation.rentGeneration,
      lateFee: config.automation.lateFee
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Manual trigger: Generate rent now
router.post('/automation/generate-rent', authenticate, authorize('superadmin'), async (req, res) => {
  try {
    const config = await SystemConfig.getConfig();
    const lateFeeConfig = config.automation?.lateFee || {};
    
    const result = await generateMonthlyRent({
      lateFeePercentage: lateFeeConfig.percentage || 5,
      gracePeriodDays: lateFeeConfig.gracePeriodDays || 5
    });
    
    if (result.success) {
      res.json({
        message: `Generated ${result.generated} payments`,
        ...result
      });
    } else {
      res.status(500).json({ 
        message: 'Failed to generate payments',
        error: result.error 
      });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Manual trigger: Calculate late fees now
router.post('/automation/calculate-late-fees', authenticate, authorize('superadmin'), async (req, res) => {
  try {
    const result = await calculateLateFees();
    
    if (result.shouldProcess) {
      res.json({
        message: `Updated ${result.updated} payments with late fees`,
        ...result
      });
    } else {
      res.json({
        message: result.reason || 'Late fee calculation skipped',
        ...result
      });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get paybill information (public endpoint)
router.get('/paybill', async (req, res) => {
  try {
    const config = await SystemConfig.getConfig();
    res.json({
      paybillNumber: config.paybillNumber,
      businessName: config.businessName,
      paymentInstructions: config.paymentInstructions,
      mobileMoneyProvider: config.mobileMoneyProvider
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;

