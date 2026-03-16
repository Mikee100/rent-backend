import express from 'express';
import mpesaService from '../services/mpesaService.js';
import Payment from '../models/Payment.js';
import House from '../models/House.js';
import Tenant from '../models/Tenant.js';

const router = express.Router();

// Initiate STK Push payment
router.post('/stk-push', async (req, res) => {
  try {
    const { phoneNumber, amount, houseNumber, tenantId, months, month, year } = req.body;

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

    // Determine months
    const now = new Date();
    const monthList = months && Array.isArray(months) && months.length > 0 
      ? months 
      : [{ month: month || String(now.getMonth() + 1).padStart(2, '0'), year: year || now.getFullYear() }];

    // Initiate STK Push first to get the checkout request ID
    const stkResult = await mpesaService.initiateSTKPush(
      phoneNumber,
      amount,
      houseNumber,
      `Rent for ${monthList.length} month(s)`
    );

    const pendingPaymentIds = [];
    const baseCount = await Payment.countDocuments();
    let remainingAmount = parseFloat(amount);

    const currentMonth = String(new Date().getMonth() + 1).padStart(2, '0');
    const currentYear = new Date().getFullYear();

    for (let i = 0; i < monthList.length; i++) {
        const { month: m, year: y } = monthList[i];
        const isAdvance = (parseInt(y) > currentYear) || (parseInt(y) === currentYear && parseInt(m) > parseInt(currentMonth));
        const dueDate = new Date(y, parseInt(m) - 1, 1);
        
        let expectedAmount = house.rentAmount;
        // Simple distribution for pending status
        let allocatedAmount = 0;
        if (monthList.length === 1) {
            allocatedAmount = remainingAmount;
        } else {
            allocatedAmount = Math.min(remainingAmount, expectedAmount);
            remainingAmount -= allocatedAmount;
            if (i === monthList.length - 1 && remainingAmount > 0) {
                allocatedAmount += remainingAmount;
            }
        }

        const receiptNumber = `RCP-${y}-${String(baseCount + i + 1).padStart(6, '0')}`;

        const pendingPayment = new Payment({
            tenant: tenant._id,
            house: house._id,
            amount: allocatedAmount,
            expectedAmount: expectedAmount,
            paidAmount: 0,
            deficit: allocatedAmount,
            dueDate: dueDate,
            paymentDate: now,
            paymentMethod: 'online',
            status: 'pending',
            month: m,
            year: y,
            houseNumber: houseNumber,
            paymentSource: 'mpesa_stk',
            receiptNumber: receiptNumber,
            isAdvance: isAdvance,
            transactionId: stkResult.checkoutRequestID, // Link all to the same checkout ID
            notes: `M-Pesa STK Push initiated for house ${houseNumber} (${m}/${y})`
        });

        await pendingPayment.save();
        pendingPaymentIds.push(pendingPayment._id);
    }

    res.json({
      success: true,
      message: stkResult.customerMessage,
      checkoutRequestID: stkResult.checkoutRequestID,
      merchantRequestID: stkResult.merchantRequestID,
      paymentIds: pendingPaymentIds
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

    // Find ALL payments by checkout request ID
    const payments = await Payment.find({ transactionId: CheckoutRequestID });

    if (payments.length === 0) {
      console.error('No payments found for CheckoutRequestID:', CheckoutRequestID);
      return res.status(404).json({ message: 'Payments not found' });
    }

    // ResultCode 0 means success
    if (ResultCode === 0 && CallbackMetadata) {
      const items = CallbackMetadata.Item || [];
      const amountItem = items.find(item => item.Name === 'Amount');
      const mpesaReceiptNumber = items.find(item => item.Name === 'MpesaReceiptNumber');
      const phoneNumber = items.find(item => item.Name === 'PhoneNumber');
      const transactionDate = items.find(item => item.Name === 'TransactionDate');

      // Update ALL payment records associated with this transaction
      for (const payment of payments) {
          payment.status = 'paid';
          payment.referenceNumber = mpesaReceiptNumber?.Value || '';
          // We keep transactionId as the mpesa receipt number for the first one, or unique per record if we want
          // but usually it's better to keep the checkout ID as a lookup key and mpesa receipt as reference
          payment.receivedFrom = phoneNumber?.Value || payment.receivedFrom;
          payment.notes = `M-Pesa payment completed (${payment.month}/${payment.year}). Receipt: ${mpesaReceiptNumber?.Value || 'N/A'}`;
          
          if (transactionDate?.Value) {
            payment.paymentDate = new Date(transactionDate.Value);
          }

          await payment.save();
      }

      console.log(`✅ ${payments.length} payment(s) completed for house ${payments[0].houseNumber}. Receipt: ${mpesaReceiptNumber?.Value}`);

      res.json({
        ResultCode: 0,
        ResultDesc: 'Payments processed successfully'
      });
    } else {
      // Payment failed or was cancelled
      for (const payment of payments) {
          payment.status = 'pending';
          payment.notes = `M-Pesa payment failed: ${ResultDesc}`;
          await payment.save();
      }

      console.log(`${payments.length} payment(s) failed for house ${payments[0].houseNumber}. Reason: ${ResultDesc}`);

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

