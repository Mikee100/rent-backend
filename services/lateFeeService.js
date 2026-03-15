import Payment from '../models/Payment.js';
import SystemConfig from '../models/SystemConfig.js';

/**
 * Calculate and apply late fees to overdue payments
 * @returns {Object} Result with updated payments count
 */
export async function calculateLateFees() {
  try {
    const config = await SystemConfig.getConfig();
    const lateFeeConfig = config.automation?.lateFee;

    if (!lateFeeConfig || !lateFeeConfig.enabled) {
      return { shouldProcess: false, reason: 'Late fee automation disabled' };
    }

    const gracePeriodDays = lateFeeConfig.gracePeriodDays || 5;
    const calculationMethod = lateFeeConfig.calculationMethod || 'percentage';
    const percentage = lateFeeConfig.percentage || 5;
    const fixedAmount = lateFeeConfig.fixedAmount || 0;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Find all pending payments that are past due date + grace period
    const payments = await Payment.find({
      status: { $in: ['pending', 'partial'] },
      dueDate: { $exists: true }
    }).populate('house tenant');

    let updatedCount = 0;
    const updates = [];

    for (const payment of payments) {
      if (!payment.dueDate) continue;

      const dueDate = new Date(payment.dueDate);
      dueDate.setHours(0, 0, 0, 0);
      
      const lateFeeDate = new Date(dueDate);
      lateFeeDate.setDate(lateFeeDate.getDate() + gracePeriodDays);
      lateFeeDate.setHours(23, 59, 59, 999);

      // Check if payment is past grace period
      if (today > lateFeeDate) {
        // Calculate late fee if not already calculated or needs update
        let newLateFee = 0;
        
        if (calculationMethod === 'percentage') {
          // Calculate percentage on the outstanding amount (deficit)
          const outstandingAmount = payment.deficit || payment.expectedAmount;
          newLateFee = (outstandingAmount * percentage) / 100;
        } else if (calculationMethod === 'fixed') {
          newLateFee = fixedAmount;
        }

        // Only update if late fee changed or status needs update
        const needsUpdate = 
          payment.lateFee !== newLateFee || 
          payment.status !== 'overdue';

        if (needsUpdate) {
          payment.lateFee = newLateFee;
          payment.status = 'overdue';
          
          // Recalculate expected amount with late fee
          const baseAmount = payment.expectedAmount - (payment.lateFee || 0);
          payment.expectedAmount = baseAmount + newLateFee;
          
          // Recalculate deficit
          payment.deficit = payment.expectedAmount - (payment.paidAmount || 0);

          await payment.save();
          updatedCount++;

          updates.push({
            paymentId: payment._id,
            tenant: payment.tenant?.firstName + ' ' + payment.tenant?.lastName,
            houseNumber: payment.house?.houseNumber,
            lateFee: newLateFee,
            status: 'overdue'
          });
        }
      }
    }

    return {
      shouldProcess: true,
      updated: updatedCount,
      updates: updates
    };
  } catch (error) {
    console.error('Error calculating late fees:', error);
    return {
      shouldProcess: false,
      error: error.message,
      updated: 0
    };
  }
}

/**
 * Check and process late fees based on configuration
 */
export async function checkAndProcessLateFees() {
  try {
    const config = await SystemConfig.getConfig();
    const lateFeeConfig = config.automation?.lateFee;

    if (!lateFeeConfig || !lateFeeConfig.enabled) {
      return { shouldProcess: false, reason: 'Late fee automation disabled' };
    }

    return await calculateLateFees();
  } catch (error) {
    console.error('Error checking late fees:', error);
    return {
      shouldProcess: false,
      error: error.message
    };
  }
}

