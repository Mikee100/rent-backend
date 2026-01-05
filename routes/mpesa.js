import express from 'express';
import mpesaService from '../services/mpesaService.js';
import Payment from '../models/Payment.js';
import House from '../models/House.js';
import Tenant from '../models/Tenant.js';

const router = express.Router();

// Initiate STK Push payment
router.post('/stk-push', async (req, res) => {
  try {
    const { phoneNumber, amount, houseNumber, tenantId, month, year } = req.body;

    if (!phoneNumber || !amount || !houseNumber) {
      return res.status(400).json({ 
        message: 'Phone number, amount, and house number are required' 
      });
    }

    // Find house
    const house = await House.findOne({ houseNumber: houseNumber.trim() })
      .populate('apartment')
      .populate('tenant');

    if (!house) {
      return res.status(404).json({ message: `House ${houseNumber} not found` });
    }

    if (!house.tenant) {
      return res.status(400).json({ 
        message: `House ${houseNumber} has no tenant assigned` 
      });
    }

    // Use tenant from house or provided tenantId
    const tenant = tenantId ? await Tenant.findById(tenantId) : house.tenant;
    if (!tenant) {
      return res.status(404).json({ message: 'Tenant not found' });
    }

    // Determine month and year
    const now = new Date();
    const paymentMonth = month || String(now.getMonth() + 1).padStart(2, '0');
    const paymentYear = year || now.getFullYear();

    // Create pending payment record
    const dueDate = new Date(paymentYear, parseInt(paymentMonth) - 1, 1);
    const count = await Payment.countDocuments();
    const receiptNumber = `RCP-${paymentYear}-${String(count + 1).padStart(6, '0')}`;

    const pendingPayment = new Payment({
      tenant: tenant._id,
      house: house._id,
      amount: parseFloat(amount),
      paymentDate: now,
      dueDate: dueDate,
      paymentMethod: 'online',
      status: 'pending',
      month: paymentMonth,
      year: paymentYear,
      houseNumber: houseNumber,
      paymentSource: 'mpesa_stk',
      receiptNumber: receiptNumber,
      notes: `M-Pesa STK Push payment initiated for house ${houseNumber}`
    });

    await pendingPayment.save();

    // Initiate STK Push
    const stkResult = await mpesaService.initiateSTKPush(
      phoneNumber,
      amount,
      houseNumber,
      `Rent payment for house ${houseNumber}`
    );

    // Update payment with checkout request ID
    pendingPayment.transactionId = stkResult.checkoutRequestID;
    await pendingPayment.save();

    res.json({
      success: true,
      message: stkResult.customerMessage,
      checkoutRequestID: stkResult.checkoutRequestID,
      merchantRequestID: stkResult.merchantRequestID,
      paymentId: pendingPayment._id,
      receiptNumber: receiptNumber
    });
  } catch (error) {
    console.error('Error initiating STK Push:', error);
    
    // Determine appropriate status code
    let statusCode = 500;
    if (error.message.includes('Missing M-Pesa configuration') || 
        error.message.includes('Consumer Key') || 
        error.message.includes('authentication failed')) {
      statusCode = 400;
    }
    
    res.status(statusCode).json({ 
      message: error.message || 'Failed to initiate M-Pesa payment',
      error: 'M-Pesa configuration error',
      hint: statusCode === 400 ? 'Please check your M-Pesa credentials in the .env file. Required: MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET, MPESA_SHORTCODE, MPESA_PASSKEY, MPESA_CALLBACK_URL' : undefined
    });
  }
});

// M-Pesa callback handler
router.post('/callback', async (req, res) => {
  try {
    const callbackData = req.body;

    // M-Pesa sends different callback structures
    const body = callbackData.Body || callbackData;
    const stkCallback = body.stkCallback || body;

    if (!stkCallback) {
      return res.status(400).json({ message: 'Invalid callback data' });
    }

    const {
      MerchantRequestID,
      CheckoutRequestID,
      ResultCode,
      ResultDesc,
      CallbackMetadata
    } = stkCallback;

    // Find payment by checkout request ID
    const payment = await Payment.findOne({ transactionId: CheckoutRequestID });

    if (!payment) {
      console.error('Payment not found for CheckoutRequestID:', CheckoutRequestID);
      return res.status(404).json({ message: 'Payment not found' });
    }

    // ResultCode 0 means success
    if (ResultCode === 0 && CallbackMetadata) {
      const items = CallbackMetadata.Item || [];
      const amountItem = items.find(item => item.Name === 'Amount');
      const mpesaReceiptNumber = items.find(item => item.Name === 'MpesaReceiptNumber');
      const phoneNumber = items.find(item => item.Name === 'PhoneNumber');
      const transactionDate = items.find(item => item.Name === 'TransactionDate');

      // Update payment status
      payment.status = 'paid';
      payment.referenceNumber = mpesaReceiptNumber?.Value || '';
      payment.transactionId = mpesaReceiptNumber?.Value || CheckoutRequestID;
      payment.receivedFrom = phoneNumber?.Value || payment.receivedFrom;
      payment.notes = `M-Pesa payment completed. Receipt: ${mpesaReceiptNumber?.Value || 'N/A'}`;
      
      if (transactionDate?.Value) {
        payment.paymentDate = new Date(transactionDate.Value);
      }

      await payment.save();

      console.log(`Payment ${payment._id} completed successfully. Receipt: ${mpesaReceiptNumber?.Value}`);

      res.json({
        ResultCode: 0,
        ResultDesc: 'Payment processed successfully'
      });
    } else {
      // Payment failed or was cancelled
      payment.status = 'pending';
      payment.notes = `M-Pesa payment failed: ${ResultDesc}`;
      await payment.save();

      console.log(`Payment ${payment._id} failed. Reason: ${ResultDesc}`);

      res.json({
        ResultCode: ResultCode,
        ResultDesc: ResultDesc || 'Payment processing failed'
      });
    }
  } catch (error) {
    console.error('Error processing M-Pesa callback:', error);
    res.status(500).json({ 
      ResultCode: 1,
      ResultDesc: 'Error processing callback' 
    });
  }
});

// Query payment status
router.get('/status/:checkoutRequestID', async (req, res) => {
  try {
    const { checkoutRequestID } = req.params;

    // Find payment
    const payment = await Payment.findOne({ transactionId: checkoutRequestID })
      .populate('tenant', 'firstName lastName')
      .populate({
        path: 'house',
        populate: {
          path: 'apartment',
          select: 'name'
        }
      });

    if (!payment) {
      return res.status(404).json({ message: 'Payment not found' });
    }

    // Query M-Pesa for latest status
    try {
      const mpesaStatus = await mpesaService.querySTKPushStatus(checkoutRequestID);
      
      res.json({
        payment: payment,
        mpesaStatus: mpesaStatus,
        status: payment.status
      });
    } catch (error) {
      // If query fails, return payment status from database
      res.json({
        payment: payment,
        status: payment.status,
        error: 'Could not query M-Pesa status'
      });
    }
  } catch (error) {
    console.error('Error querying payment status:', error);
    res.status(500).json({ message: error.message });
  }
});

export default router;

