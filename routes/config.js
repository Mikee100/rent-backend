import express from 'express';
import SystemConfig from '../models/SystemConfig.js';
import { authenticate, authorize } from '../middleware/auth.js';

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
    res.json(config);
  } catch (error) {
    res.status(400).json({ message: error.message });
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

