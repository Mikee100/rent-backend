import cron from 'node-cron';
import { checkAndGenerateRent } from './rentGenerationService.js';
import { checkAndProcessLateFees } from './lateFeeService.js';
import SystemConfig from '../models/SystemConfig.js';

let rentGenerationJob = null;
let lateFeeJob = null;

/**
 * Initialize and start all automation cron jobs
 */
export async function startAutomationJobs() {
  try {
    const config = await SystemConfig.getConfig();
    
    // Start rent generation job
    if (config.automation?.rentGeneration?.enabled) {
      startRentGenerationJob(config.automation.rentGeneration);
    }

    // Start late fee calculation job
    if (config.automation?.lateFee?.enabled) {
      startLateFeeJob(config.automation.lateFee);
    }

    console.log('✅ Automation jobs initialized');
  } catch (error) {
    console.error('Error starting automation jobs:', error);
  }
}

/**
 * Start rent generation cron job
 */
function startRentGenerationJob(rentConfig) {
  if (rentGenerationJob) {
    rentGenerationJob.stop();
  }

  const dayOfMonth = rentConfig.dayOfMonth || 1;
  const time = rentConfig.time || '00:00';
  const [hour, minute] = time.split(':').map(Number);

  // Cron expression: minute hour day-of-month * *
  // Example: "0 0 1 * *" = At 00:00 on day-of-month 1
  const cronExpression = `${minute} ${hour} ${dayOfMonth} * *`;

  rentGenerationJob = cron.schedule(cronExpression, async () => {
    console.log(`[Automation] Running scheduled rent generation at ${new Date().toISOString()}`);
    try {
      const result = await checkAndGenerateRent();
      if (result.shouldGenerate) {
        console.log(`[Automation] Generated ${result.generated} rent payments`);
        if (result.errors > 0) {
          console.warn(`[Automation] ${result.errors} errors during rent generation`);
        }
      }
    } catch (error) {
      console.error('[Automation] Error in rent generation job:', error);
    }
  }, {
    scheduled: true,
    timezone: 'Africa/Nairobi' // Adjust to your timezone
  });

  console.log(`✅ Rent generation job scheduled: Day ${dayOfMonth} at ${time}`);
}

/**
 * Start late fee calculation cron job
 */
function startLateFeeJob(lateFeeConfig) {
  if (lateFeeJob) {
    lateFeeJob.stop();
  }

  const frequency = lateFeeConfig.checkFrequency || 'daily';
  
  let cronExpression;
  if (frequency === 'hourly') {
    // Run every hour at minute 0
    cronExpression = '0 * * * *';
  } else {
    // Run daily at 1:00 AM
    cronExpression = '0 1 * * *';
  }

  lateFeeJob = cron.schedule(cronExpression, async () => {
    console.log(`[Automation] Running scheduled late fee calculation at ${new Date().toISOString()}`);
    try {
      const result = await checkAndProcessLateFees();
      if (result.shouldProcess) {
        console.log(`[Automation] Updated ${result.updated} payments with late fees`);
      }
    } catch (error) {
      console.error('[Automation] Error in late fee job:', error);
    }
  }, {
    scheduled: true,
    timezone: 'Africa/Nairobi' // Adjust to your timezone
  });

  console.log(`✅ Late fee calculation job scheduled: ${frequency}`);
}

/**
 * Stop all automation jobs
 */
export function stopAutomationJobs() {
  if (rentGenerationJob) {
    rentGenerationJob.stop();
    rentGenerationJob = null;
  }
  if (lateFeeJob) {
    lateFeeJob.stop();
    lateFeeJob = null;
  }
  console.log('Automation jobs stopped');
}

/**
 * Restart automation jobs (useful when config changes)
 */
export async function restartAutomationJobs() {
  stopAutomationJobs();
  await startAutomationJobs();
}

