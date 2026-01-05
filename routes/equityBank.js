import express from 'express';
import Payment from '../models/Payment.js';
import Tenant from '../models/Tenant.js';
import House from '../models/House.js';
import crypto from 'crypto';

const router = express.Router();

/**
 * Equity Bank Webhook Endpoint
 * This endpoint receives payment notifications from Equity Bank
 * when a tenant makes a payment to the account.
 * 
 * Expected webhook payload structure (adjust based on Equity Bank's actual format):
 * {
 *   accountNumber: "1234567890",  // Tenant's bank account number
 *   amount: 5000,
 *   transactionId: "TXN123456",
 *   referenceNumber: "REF789",
 *   transactionDate: "2024-01-15T10:30:00Z",
 *   payerName: "John Doe",
 *   description: "Rent payment"
 * }
 */
router.post('/webhook', async (req, res) => {
  try {
    // Respond quickly to Equity Bank (they may timeout if response is slow)
    res.status(200).json({
      success: true,
      message: 'Webhook received'
    });

    // Process payment asynchronously
    processEquityBankPayment(req.body).catch(error => {
      console.error('Error processing Equity Bank payment:', error);
    });
  } catch (error) {
    console.error('Error in Equity Bank webhook:', error);
    // Always respond to webhook, even on error
    res.status(200).json({
      success: false,
      message: 'Webhook received but processing failed'
    });
  }
});

/**
 * Process Equity Bank payment notification
 */
async function processEquityBankPayment(webhookData) {
  try {
    // Extract payment information from webhook
    // Adjust field names based on Equity Bank's actual webhook format
    const accountNumber = webhookData.accountNumber || 
                         webhookData.account_number || 
                         webhookData.destinationAccount ||
                         webhookData.destination_account;
    
    const amount = parseFloat(webhookData.amount || webhookData.transactionAmount || 0);
    const transactionId = webhookData.transactionId || 
                        webhookData.transaction_id || 
                        webhookData.reference ||
                        webhookData.transactionReference;
    
    const referenceNumber = webhookData.referenceNumber || 
                           webhookData.reference_number || 
                           webhookData.reference ||
                           transactionId;
    
    const transactionDate = webhookData.transactionDate || 
                            webhookData.transaction_date || 
                            webhookData.date ||
                            new Date();
    
    const payerName = webhookData.payerName || 
                     webhookData.payer_name || 
                     webhookData.remitterName ||
                     webhookData.remitter_name ||
                     webhookData.fromAccountName ||
                     'Unknown';

    // Validate required fields
    if (!accountNumber || !amount || amount <= 0) {
      console.error('Invalid webhook data: missing accountNumber or amount', webhookData);
      return;
    }

    // Find tenant by bank account number
    const tenant = await Tenant.findOne({ 
      bankAccountNumber: accountNumber.toString().trim(),
      status: 'active'
    }).populate('house');

    if (!tenant) {
      console.error(`Tenant not found for account number: ${accountNumber}`);
      return;
    }

    if (!tenant.house) {
      console.error(`Tenant ${tenant._id} has no house assigned`);
      return;
    }

    // Check if payment already exists (prevent duplicates)
    if (transactionId) {
      const existingPayment = await Payment.findOne({ transactionId: transactionId.toString() });
      if (existingPayment) {
        console.log(`Payment with transaction ID ${transactionId} already exists`);
        return;
      }
    }

    // Determine month and year from transaction date
    const paymentDate = new Date(transactionDate);
    const month = String(paymentDate.getMonth() + 1).padStart(2, '0');
    const year = paymentDate.getFullYear();

    // Check if payment already exists for this month/year
    const existingMonthlyPayment = await Payment.findOne({
      tenant: tenant._id,
      house: tenant.house._id,
      month,
      year,
      status: 'paid'
    });

    if (existingMonthlyPayment) {
      // If payment exists but amount is different, create a new payment record
      // This handles cases where tenant pays multiple times in a month
      if (existingMonthlyPayment.amount !== amount) {
        console.log(`Additional payment for ${month}/${year} - creating new record`);
      } else {
        console.log(`Payment already exists for tenant ${tenant._id} for ${month}/${year}`);
        return;
      }
    }

    // Calculate due date (first of the month)
    const dueDate = new Date(year, parseInt(month) - 1, 1);

    // Get house rent amount
    const house = await House.findById(tenant.house._id);
    if (!house) {
      console.error(`House ${tenant.house._id} not found`);
      return;
    }

    // Calculate expected amount (rent + any carried forward deficit)
    let carriedForward = 0;
    const prevMonth = parseInt(month) - 1;
    const prevYear = prevMonth === 0 ? year - 1 : year;
    const prevMonthStr = prevMonth === 0 ? '12' : String(prevMonth).padStart(2, '0');
    
    const prevPayment = await Payment.findOne({
      tenant: tenant._id,
      house: house._id,
      month: prevMonthStr,
      year: prevYear
    }).sort({ createdAt: -1 });

    if (prevPayment && prevPayment.deficit > 0) {
      carriedForward = prevPayment.deficit;
    }

    const expectedAmount = house.rentAmount + carriedForward;
    const paidAmount = amount;
    const deficit = Math.max(0, expectedAmount - paidAmount);

    // Determine payment status
    let status = 'paid';
    if (paidAmount < expectedAmount) {
      status = 'partial';
    }

    // Generate receipt number
    const count = await Payment.countDocuments();
    const receiptNumber = `RCP-${year}-${String(count + 1).padStart(6, '0')}`;

    // Create payment record
    const payment = new Payment({
      tenant: tenant._id,
      house: house._id,
      amount: paidAmount,
      expectedAmount: expectedAmount,
      paidAmount: paidAmount,
      deficit: deficit,
      carriedForward: carriedForward,
      paymentDate: paymentDate,
      dueDate: dueDate,
      paymentMethod: 'equity_bank',
      status: status,
      month: month,
      year: year,
      transactionId: transactionId?.toString() || referenceNumber?.toString(),
      referenceNumber: referenceNumber?.toString() || transactionId?.toString(),
      receivedFrom: payerName,
      houseNumber: house.houseNumber,
      paymentSource: 'equity_bank',
      receiptNumber: receiptNumber,
      notes: `Equity Bank payment received. Account: ${accountNumber}, Transaction: ${transactionId || referenceNumber}`
    });

    await payment.save();

    console.log(`✅ Equity Bank payment recorded: ${receiptNumber} for tenant ${tenant.firstName} ${tenant.lastName}, amount ${amount}, account ${accountNumber}`);

    return payment;
  } catch (error) {
    console.error('Error processing Equity Bank payment:', error);
    throw error;
  }
}

/**
 * Manual payment entry endpoint (for testing or manual reconciliation)
 * This allows admins to manually record Equity Bank payments
 */
router.post('/manual-payment', async (req, res) => {
  try {
    const {
      accountNumber,
      amount,
      transactionId,
      referenceNumber,
      transactionDate,
      payerName,
      notes
    } = req.body;

    if (!accountNumber || !amount) {
      return res.status(400).json({ 
        message: 'Account number and amount are required' 
      });
    }

    // Find tenant by account number
    const tenant = await Tenant.findOne({ 
      bankAccountNumber: accountNumber.toString().trim(),
      status: 'active'
    }).populate('house');

    if (!tenant) {
      return res.status(404).json({ 
        message: `Tenant not found for account number: ${accountNumber}` 
      });
    }

    if (!tenant.house) {
      return res.status(400).json({ 
        message: `Tenant has no house assigned` 
      });
    }

    // Check for duplicate transaction
    if (transactionId) {
      const existingPayment = await Payment.findOne({ 
        transactionId: transactionId.toString() 
      });
      if (existingPayment) {
        return res.status(400).json({ 
          message: 'Payment with this transaction ID already exists',
          receiptNumber: existingPayment.receiptNumber
        });
      }
    }

    // Determine month and year
    const paymentDate = transactionDate ? new Date(transactionDate) : new Date();
    const month = String(paymentDate.getMonth() + 1).padStart(2, '0');
    const year = paymentDate.getFullYear();

    // Get house
    const house = await House.findById(tenant.house._id);
    if (!house) {
      return res.status(404).json({ message: 'House not found' });
    }

    // Calculate expected amount
    let carriedForward = 0;
    const prevMonth = parseInt(month) - 1;
    const prevYear = prevMonth === 0 ? year - 1 : year;
    const prevMonthStr = prevMonth === 0 ? '12' : String(prevMonth).padStart(2, '0');
    
    const prevPayment = await Payment.findOne({
      tenant: tenant._id,
      house: house._id,
      month: prevMonthStr,
      year: prevYear
    }).sort({ createdAt: -1 });

    if (prevPayment && prevPayment.deficit > 0) {
      carriedForward = prevPayment.deficit;
    }

    const expectedAmount = house.rentAmount + carriedForward;
    const paidAmount = parseFloat(amount);
    const deficit = Math.max(0, expectedAmount - paidAmount);

    // Determine status
    let status = 'paid';
    if (paidAmount < expectedAmount) {
      status = 'partial';
    }

    // Generate receipt number
    const count = await Payment.countDocuments();
    const receiptNumber = `RCP-${year}-${String(count + 1).padStart(6, '0')}`;

    // Create payment
    const payment = new Payment({
      tenant: tenant._id,
      house: house._id,
      amount: paidAmount,
      expectedAmount: expectedAmount,
      paidAmount: paidAmount,
      deficit: deficit,
      carriedForward: carriedForward,
      paymentDate: paymentDate,
      dueDate: new Date(year, parseInt(month) - 1, 1),
      paymentMethod: 'equity_bank',
      status: status,
      month: month,
      year: year,
      transactionId: transactionId?.toString(),
      referenceNumber: referenceNumber?.toString() || transactionId?.toString(),
      receivedFrom: payerName || `${tenant.firstName} ${tenant.lastName}`,
      houseNumber: house.houseNumber,
      paymentSource: 'equity_bank',
      receiptNumber: receiptNumber,
      notes: notes || `Equity Bank payment - Account: ${accountNumber}`
    });

    await payment.save();

    const populatedPayment = await Payment.findById(payment._id)
      .populate('tenant', 'firstName lastName email phone')
      .populate({
        path: 'house',
        populate: {
          path: 'apartment',
          select: 'name address'
        }
      });

    res.status(201).json({
      message: 'Equity Bank payment recorded successfully',
      payment: populatedPayment,
      receiptNumber: receiptNumber
    });
  } catch (error) {
    console.error('Error recording manual Equity Bank payment:', error);
    res.status(400).json({ message: error.message });
  }
});

/**
 * Verify account number endpoint
 * Allows checking if an account number is registered to a tenant
 */
router.get('/verify-account/:accountNumber', async (req, res) => {
  try {
    const { accountNumber } = req.params;

    const tenant = await Tenant.findOne({ 
      bankAccountNumber: accountNumber.toString().trim()
    })
    .populate('house')
    .populate({
      path: 'house',
      populate: {
        path: 'apartment',
        select: 'name address'
      }
    });

    if (!tenant) {
      return res.status(404).json({ 
        message: 'Account number not found',
        accountNumber: accountNumber
      });
    }

    res.json({
      found: true,
      tenant: {
        _id: tenant._id,
        firstName: tenant.firstName,
        lastName: tenant.lastName,
        email: tenant.email,
        phone: tenant.phone,
        bankAccountNumber: tenant.bankAccountNumber,
        bankName: tenant.bankName
      },
      house: tenant.house ? {
        _id: tenant.house._id,
        houseNumber: tenant.house.houseNumber,
        rentAmount: tenant.house.rentAmount,
        apartment: tenant.house.apartment
      } : null
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;

