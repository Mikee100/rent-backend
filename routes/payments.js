import express from 'express';
import Payment from '../models/Payment.js';
import Tenant from '../models/Tenant.js';
import House from '../models/House.js';
import { authenticate, filterByApartment, authorize } from '../middleware/auth.js';
import { logActivity } from '../middleware/activityLogger.js';

const router = express.Router();

// Get all payments
router.get('/', authenticate, filterByApartment, logActivity({
  action: 'view',
  entityType: 'payment',
  description: (req) => {
    const role = req.user?.role || 'user';
    const filters = [];
    if (req.query.status) filters.push(`status: ${req.query.status}`);
    if (req.query.apartment) filters.push(`apartment: ${req.query.apartment}`);
    const filterText = filters.length > 0 ? ` (filters: ${filters.join(', ')})` : '';
    return `[${role.toUpperCase()}] Viewed payments list${filterText}`;
  }
}), async (req, res) => {
  try {
    let query = {};
    
    // Filter payments by apartment for caretakers
    if (req.apartmentFilter) {
      const houses = await House.find(req.apartmentFilter).select('_id');
      const houseIds = houses.map(h => h._id);
      query = { house: { $in: houseIds } };
    }
    
    const payments = await Payment.find(query)
      .populate('tenant', 'firstName lastName email')
      .populate({
        path: 'house',
        populate: {
          path: 'apartment',
          select: 'name address'
        }
      })
      .sort({ paymentDate: -1 });
    res.json(payments);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get single payment
router.get('/:id', authenticate, filterByApartment, async (req, res) => {
  try {
    const payment = await Payment.findById(req.params.id)
      .populate('tenant')
      .populate({
        path: 'house',
        populate: {
          path: 'apartment',
          select: 'name address'
        }
      });
    if (!payment) {
      return res.status(404).json({ message: 'Payment not found' });
    }

    // Check if caretaker can access this payment
    if (req.user.role === 'caretaker' && req.user.apartment && payment.house) {
      const apartmentId = req.user.apartment._id || req.user.apartment;
      const houseApartmentId = payment.house.apartment._id || payment.house.apartment;
      if (apartmentId.toString() !== houseApartmentId.toString()) {
        return res.status(403).json({ message: 'Access denied.' });
      }
    }

    res.json(payment);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get payments by tenant
router.get('/tenant/:tenantId', authenticate, filterByApartment, async (req, res) => {
  try {
    let query = { tenant: req.params.tenantId };
    
    // Filter by apartment for caretakers
    if (req.apartmentFilter) {
      const houses = await House.find(req.apartmentFilter).select('_id');
      const houseIds = houses.map(h => h._id);
      query = { ...query, house: { $in: houseIds } };
    }
    
    const payments = await Payment.find(query)
      .populate({
        path: 'house',
        populate: {
          path: 'apartment',
          select: 'name address'
        }
      })
      .sort({ paymentDate: -1 });
    res.json(payments);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get payments by house
router.get('/house/:houseId', authenticate, filterByApartment, async (req, res) => {
  try {
    // Check if caretaker can access this house's payments
    if (req.user.role === 'caretaker' && req.user.apartment) {
      const house = await House.findById(req.params.houseId).populate('apartment');
      if (house) {
        const apartmentId = req.user.apartment._id || req.user.apartment;
        const houseApartmentId = house.apartment._id || house.apartment;
        if (apartmentId.toString() !== houseApartmentId.toString()) {
          return res.status(403).json({ message: 'Access denied.' });
        }
      }
    }

    const payments = await Payment.find({ house: req.params.houseId })
      .populate('tenant', 'firstName lastName')
      .sort({ paymentDate: -1 });
    res.json(payments);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get payments by apartment
router.get('/apartment/:apartmentId', authenticate, filterByApartment, async (req, res) => {
  try {
    // Check if caretaker can access this apartment
    if (req.user.role === 'caretaker' && req.user.apartment) {
      const apartmentId = req.user.apartment._id || req.user.apartment;
      if (req.params.apartmentId !== apartmentId.toString()) {
        return res.status(403).json({ message: 'Access denied.' });
      }
    }

    const houses = await House.find({ apartment: req.params.apartmentId });
    const houseIds = houses.map(h => h._id);
    const payments = await Payment.find({ house: { $in: houseIds } })
      .populate('tenant', 'firstName lastName')
      .populate({
        path: 'house',
        select: 'houseNumber'
      })
      .sort({ paymentDate: -1 });
    res.json(payments);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Create payment
router.post('/', async (req, res) => {
  try {
    // If houseNumber is provided, find the house
    if (req.body.houseNumber && !req.body.house) {
      const house = await House.findOne({ houseNumber: req.body.houseNumber });
      if (!house) {
        return res.status(404).json({ message: `House with number ${req.body.houseNumber} not found` });
      }
      req.body.house = house._id;
      
      // If tenant is not provided but house has a tenant, use it
      if (!req.body.tenant && house.tenant) {
        req.body.tenant = house.tenant;
      }
    }

    // Generate receipt number if not provided
    if (!req.body.receiptNumber) {
      const count = await Payment.countDocuments();
      req.body.receiptNumber = `RCP-${new Date().getFullYear()}-${String(count + 1).padStart(6, '0')}`;
    }

    // Get house to determine rent amount
    let house = null;
    if (req.body.house) {
      house = await House.findById(req.body.house);
    }

    if (!house) {
      return res.status(400).json({ message: 'House is required' });
    }

    // Calculate expected amount (rent + any carried forward deficit)
    let carriedForward = 0;
    if (req.body.tenant && req.body.month && req.body.year) {
      // Find previous month's payment to get deficit
      const prevMonth = parseInt(req.body.month) - 1;
      const prevYear = prevMonth === 0 ? parseInt(req.body.year) - 1 : parseInt(req.body.year);
      const prevMonthStr = prevMonth === 0 ? '12' : String(prevMonth).padStart(2, '0');
      
      const prevPayment = await Payment.findOne({
        tenant: req.body.tenant,
        house: house._id,
        month: prevMonthStr,
        year: prevYear
      }).sort({ createdAt: -1 });

      if (prevPayment && prevPayment.deficit > 0) {
        carriedForward = prevPayment.deficit;
      }
    }

    const expectedAmount = house.rentAmount + carriedForward;
    const paidAmount = req.body.amount || 0;
    const deficit = Math.max(0, expectedAmount - paidAmount);

    // Set payment status
    let status = 'pending';
    if (paidAmount >= expectedAmount) {
      status = 'paid';
    } else if (paidAmount > 0) {
      status = 'partial';
    }

    // Create payment with calculated values
    const paymentData = {
      ...req.body,
      expectedAmount: expectedAmount,
      paidAmount: paidAmount,
      deficit: deficit,
      carriedForward: carriedForward,
      status: status
    };

    const payment = new Payment(paymentData);
    await payment.save();

    const populatedPayment = await Payment.findById(payment._id)
      .populate('tenant', 'firstName lastName email')
      .populate({
        path: 'house',
        populate: {
          path: 'apartment',
          select: 'name address'
        }
      });
    res.status(201).json(populatedPayment);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Update payment
router.put('/:id', async (req, res) => {
  try {
    const payment = await Payment.findById(req.params.id).populate('house');
    if (!payment) {
      return res.status(404).json({ message: 'Payment not found' });
    }

    // If amount is being updated, recalculate deficit
    if (req.body.amount !== undefined) {
      const expectedAmount = payment.expectedAmount || payment.house.rentAmount + (payment.carriedForward || 0);
      const paidAmount = req.body.amount;
      const deficit = Math.max(0, expectedAmount - paidAmount);

      req.body.paidAmount = paidAmount;
      req.body.deficit = deficit;

      // Update status based on payment
      if (paidAmount >= expectedAmount) {
        req.body.status = 'paid';
      } else if (paidAmount > 0) {
        req.body.status = 'partial';
      } else {
        req.body.status = 'pending';
      }
    }

    const updatedPayment = await Payment.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    )
      .populate('tenant', 'firstName lastName email')
      .populate({
        path: 'house',
        populate: {
          path: 'apartment',
          select: 'name address'
        }
      });
    
    res.json(updatedPayment);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Delete payment
router.delete('/:id', authenticate, authorize('superadmin'), logActivity({
  action: 'delete',
  entityType: 'payment',
  getEntityName: async (req) => {
    const payment = await Payment.findById(req.params.id).populate('tenant');
    return payment?.receiptNumber || (payment?.tenant ? `${payment.tenant.firstName} ${payment.tenant.lastName}`.trim() : null);
  }
}), async (req, res) => {
  try {
    const payment = await Payment.findByIdAndDelete(req.params.id);
    if (!payment) {
      return res.status(404).json({ message: 'Payment not found' });
    }
    res.json({ message: 'Payment deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Generate monthly rent payments for all active tenants
router.post('/generate-monthly-rent', async (req, res) => {
  try {
    const { month, year, lateFeePercentage = 5, gracePeriodDays = 5 } = req.body;
    
    const targetMonth = month || String(new Date().getMonth() + 1).padStart(2, '0');
    const targetYear = year || new Date().getFullYear();
    
    // Get all active tenants with houses
    const tenants = await Tenant.find({ 
      status: 'active',
      house: { $ne: null }
    }).populate('house');

    const generatedPayments = [];
    const errors = [];

    for (const tenant of tenants) {
      if (!tenant.house) continue;

      // Check if payment already exists for this month/year
      const existingPayment = await Payment.findOne({
        tenant: tenant._id,
        house: tenant.house._id,
        month: targetMonth,
        year: targetYear
      });

      if (existingPayment) {
        errors.push(`Payment already exists for ${tenant.firstName} ${tenant.lastName} - ${targetMonth}/${targetYear}`);
        continue;
      }

      // Calculate due date (first of the month)
      const dueDate = new Date(targetYear, parseInt(targetMonth) - 1, 1);
      
      // Get previous month's deficit to carry forward
      let carriedForward = 0;
      const prevMonth = parseInt(targetMonth) - 1;
      const prevYear = prevMonth === 0 ? targetYear - 1 : targetYear;
      const prevMonthStr = prevMonth === 0 ? '12' : String(prevMonth).padStart(2, '0');
      
      const prevPayment = await Payment.findOne({
        tenant: tenant._id,
        house: tenant.house._id,
        month: prevMonthStr,
        year: prevYear
      }).sort({ createdAt: -1 });

      if (prevPayment && prevPayment.deficit > 0) {
        carriedForward = prevPayment.deficit;
      }
      
      // Calculate expected amount (rent + carried forward deficit)
      const expectedAmount = tenant.house.rentAmount + carriedForward;
      
      // Calculate late fee if past due date + grace period
      const today = new Date();
      const lateFeeDate = new Date(dueDate);
      lateFeeDate.setDate(lateFeeDate.getDate() + gracePeriodDays);
      
      let lateFee = 0;
      let status = 'pending';
      
      if (today > lateFeeDate) {
        lateFee = (expectedAmount * lateFeePercentage) / 100;
        status = 'overdue';
      }

      const payment = new Payment({
        tenant: tenant._id,
        house: tenant.house._id,
        amount: expectedAmount, // This is the expected amount, not paid amount
        expectedAmount: expectedAmount,
        paidAmount: 0, // No payment received yet
        deficit: expectedAmount, // Full amount is deficit until paid
        carriedForward: carriedForward,
        dueDate: dueDate,
        paymentDate: today,
        month: targetMonth,
        year: targetYear,
        status: status,
        lateFee: lateFee,
        isAutoGenerated: true,
        autoGeneratedDate: today
      });

      await payment.save();
      generatedPayments.push(payment);
    }

    res.json({
      message: `Generated ${generatedPayments.length} payments`,
      generated: generatedPayments.length,
      errors: errors.length,
      details: errors
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// M-Pesa C2B Confirmation URL (called automatically by M-Pesa when paybill payment is received)
// This endpoint is called by M-Pesa when a tenant pays via paybill
// Format: M-Pesa sends the account number (house number) in BillRefNumber field
router.post('/mpesa-confirmation', async (req, res) => {
  try {
    // M-Pesa C2B sends data in this format:
    const {
      TransactionType,
      TransID,
      TransTime,
      TransAmount,
      BusinessShortCode,
      BillRefNumber, // This is the account number (house number) entered by tenant
      InvoiceNumber,
      OrgAccountBalance,
      ThirdPartyTransID,
      MSISDN, // Phone number
      FirstName,
      MiddleName,
      LastName
    } = req.body;

    // Respond to M-Pesa immediately (they require quick response within 5 seconds)
    res.json({
      ResultCode: 0,
      ResultDesc: 'Confirmation received successfully'
    });

    // Process payment asynchronously
    if (BillRefNumber && TransAmount && TransID) {
      try {
        // Find house by house number (account number)
        const house = await House.findOne({ houseNumber: BillRefNumber.trim() })
          .populate('apartment')
          .populate('tenant');

        if (!house) {
          console.error(`House ${BillRefNumber} not found for M-Pesa payment ${TransID}`);
          return;
        }

        if (!house.tenant) {
          console.error(`House ${BillRefNumber} has no tenant for M-Pesa payment ${TransID}`);
          return;
        }

        // Check if payment already exists
        const existingPayment = await Payment.findOne({ transactionId: TransID });
        if (existingPayment) {
          console.log(`Payment ${TransID} already exists`);
          return;
        }

        // Determine month and year
        const transDate = new Date(TransTime);
        const month = String(transDate.getMonth() + 1).padStart(2, '0');
        const year = transDate.getFullYear();

        // Check for duplicate payment for this month/year
        const duplicatePayment = await Payment.findOne({
          house: house._id,
          tenant: house.tenant._id,
          month,
          year,
          status: 'paid'
        });

        if (duplicatePayment) {
          console.log(`Payment already exists for house ${BillRefNumber} for ${month}/${year}`);
          return;
        }

        // Calculate due date
        const dueDate = new Date(year, parseInt(month) - 1, 1);

        // Determine status
        let status = 'paid';
        if (parseFloat(TransAmount) < house.rentAmount) {
          status = 'partial';
        }

        // Generate receipt number
        const count = await Payment.countDocuments();
        const receiptNumber = `RCP-${year}-${String(count + 1).padStart(6, '0')}`;

        // Create payment
        const payment = new Payment({
          tenant: house.tenant._id,
          house: house._id,
          amount: parseFloat(TransAmount),
          paymentDate: transDate,
          dueDate: dueDate,
          paymentMethod: 'mobile_money',
          status: status,
          month: month,
          year: year,
          transactionId: TransID,
          referenceNumber: TransID,
          receivedFrom: MSISDN || `${FirstName || ''} ${MiddleName || ''} ${LastName || ''}`.trim() || house.tenant.firstName + ' ' + house.tenant.lastName,
          houseNumber: BillRefNumber,
          paymentSource: 'paybill',
          receiptNumber: receiptNumber,
          notes: `M-Pesa paybill payment received. Transaction ID: ${TransID}`
        });

        await payment.save();
        console.log(`✅ M-Pesa payment recorded: ${receiptNumber} for house ${BillRefNumber}, amount ${TransAmount}`);
      } catch (error) {
        console.error('Error processing M-Pesa payment:', error);
      }
    }
  } catch (error) {
    console.error('Error processing M-Pesa confirmation:', error);
    // Always respond to M-Pesa, even on error
    res.json({
      ResultCode: 0,
      ResultDesc: 'Callback received'
    });
  }
});

// M-Pesa C2B Validation URL (optional, called before confirmation)
// M-Pesa calls this to validate the account number before processing payment
router.post('/mpesa-validation', async (req, res) => {
  try {
    const accountNumber = req.body.BillRefNumber || req.body.AccountReference;
    
    if (accountNumber) {
      const house = await House.findOne({ houseNumber: accountNumber.trim() });
      if (house && house.tenant) {
        // Valid house with tenant - accept payment
        res.json({
          ResultCode: 0,
          ResultDesc: 'Accepted'
        });
      } else {
        // Invalid account number - reject payment
        res.json({
          ResultCode: 1,
          ResultDesc: 'Invalid account number. Please check your house number.'
        });
      }
    } else {
      // No account number provided - accept (M-Pesa will handle validation)
      res.json({
        ResultCode: 0,
        ResultDesc: 'Accepted'
      });
    }
  } catch (error) {
    // On error, accept to avoid blocking legitimate payments
    res.json({
      ResultCode: 0,
      ResultDesc: 'Accepted'
    });
  }
});

// Receive payment via paybill (account number = house number)
// This endpoint can be called by:
// 1. M-Pesa webhook (after configuration)
// 2. Manual entry from admin
// 3. External payment processors
router.post('/paybill', async (req, res) => {
  try {
    const { 
      accountNumber, // This is the house number
      amount, 
      transactionId, 
      referenceNumber, 
      phoneNumber,
      paymentMethod = 'mobile_money',
      notes 
    } = req.body;

    // Validate paybill number if provided
    const { paybillNumber } = req.body;
    if (paybillNumber) {
      const SystemConfig = (await import('../models/SystemConfig.js')).default;
      const config = await SystemConfig.getConfig();
      if (config.paybillNumber && config.paybillNumber !== paybillNumber) {
        return res.status(400).json({ message: 'Invalid paybill number' });
      }
    }

    if (!accountNumber || !amount) {
      return res.status(400).json({ message: 'Account number (house number) and amount are required' });
    }

    // Find house by house number (account number)
    const house = await House.findOne({ houseNumber: accountNumber.trim() })
      .populate('apartment')
      .populate('tenant');

    if (!house) {
      return res.status(404).json({ 
        message: `House with number ${accountNumber} not found`,
        accountNumber: accountNumber,
        suggestion: 'Please verify the house number and try again'
      });
    }

    if (!house.tenant) {
      return res.status(400).json({ 
        message: `House ${accountNumber} has no tenant assigned`,
        accountNumber: accountNumber
      });
    }

    // Check for existing payment with same transaction ID
    if (transactionId) {
      const existingPayment = await Payment.findOne({ transactionId });
      if (existingPayment) {
        return res.status(400).json({ 
          message: 'Payment with this transaction ID already exists',
          receiptNumber: existingPayment.receiptNumber
        });
      }
    }

    // Determine month and year
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();

    // Check if payment already exists for this month/year
    const existingPayment = await Payment.findOne({
      house: house._id,
      tenant: house.tenant._id,
      month,
      year,
      status: 'paid'
    });

    if (existingPayment) {
      return res.status(400).json({ 
        message: `Payment already exists for house ${accountNumber} for ${month}/${year}`,
        existingPayment: existingPayment._id,
        receiptNumber: existingPayment.receiptNumber
      });
    }

    // Calculate due date (first of the month)
    const dueDate = new Date(year, parseInt(month) - 1, 1);

    // Determine status
    let status = 'paid';
    if (amount < house.rentAmount) {
      status = 'partial';
    }

    // Generate receipt number
    const count = await Payment.countDocuments();
    const receiptNumber = `RCP-${year}-${String(count + 1).padStart(6, '0')}`;

    // Create payment
    const payment = new Payment({
      tenant: house.tenant._id,
      house: house._id,
      amount: parseFloat(amount),
      paymentDate: now,
      dueDate: dueDate,
      paymentMethod: paymentMethod,
      status: status,
      month: month,
      year: year,
      transactionId: transactionId || referenceNumber,
      referenceNumber: referenceNumber,
      receivedFrom: phoneNumber || house.tenant.firstName + ' ' + house.tenant.lastName,
      houseNumber: accountNumber,
      paymentSource: 'paybill',
      receiptNumber: receiptNumber,
      notes: notes || `Paybill payment received for house ${accountNumber}${phoneNumber ? ` from ${phoneNumber}` : ''}`
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
      message: 'Paybill payment received and recorded successfully',
      payment: populatedPayment,
      receiptNumber: receiptNumber,
      tenant: {
        name: `${house.tenant.firstName} ${house.tenant.lastName}`,
        phone: house.tenant.phone,
        email: house.tenant.email
      },
      house: {
        number: house.houseNumber,
        apartment: house.apartment?.name
      }
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Receive payment via webhook/API (for external payment systems)
router.post('/receive', async (req, res) => {
  try {
    const { houseNumber, amount, transactionId, referenceNumber, receivedFrom, paymentMethod, notes } = req.body;

    if (!houseNumber || !amount) {
      return res.status(400).json({ message: 'House number and amount are required' });
    }

    // Find house by house number
    const house = await House.findOne({ houseNumber: houseNumber.trim() })
      .populate('apartment')
      .populate('tenant');

    if (!house) {
      return res.status(404).json({ 
        message: `House with number ${houseNumber} not found`,
        houseNumber: houseNumber
      });
    }

    if (!house.tenant) {
      return res.status(400).json({ 
        message: `House ${houseNumber} has no tenant assigned`,
        houseNumber: houseNumber
      });
    }

    // Check for existing payment with same transaction ID
    if (transactionId) {
      const existingPayment = await Payment.findOne({ transactionId });
      if (existingPayment) {
        return res.status(400).json({ message: 'Payment with this transaction ID already exists' });
      }
    }

    // Determine month and year
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();

    // Check if payment already exists for this month/year
    const existingPayment = await Payment.findOne({
      house: house._id,
      tenant: house.tenant._id,
      month,
      year,
      status: 'paid'
    });

    if (existingPayment) {
      return res.status(400).json({ 
        message: `Payment already exists for house ${houseNumber} for ${month}/${year}`,
        existingPayment: existingPayment._id
      });
    }

    // Calculate due date (first of the month)
    const dueDate = new Date(year, parseInt(month) - 1, 1);

    // Determine status
    let status = 'paid';
    if (amount < house.rentAmount) {
      status = 'partial';
    }

    // Generate receipt number
    const count = await Payment.countDocuments();
    const receiptNumber = `RCP-${year}-${String(count + 1).padStart(6, '0')}`;

    // Create payment
    const payment = new Payment({
      tenant: house.tenant._id,
      house: house._id,
      amount: parseFloat(amount),
      paymentDate: now,
      dueDate: dueDate,
      paymentMethod: paymentMethod || 'bank_transfer',
      status: status,
      month: month,
      year: year,
      transactionId: transactionId,
      referenceNumber: referenceNumber,
      receivedFrom: receivedFrom || house.tenant.firstName + ' ' + house.tenant.lastName,
      houseNumber: houseNumber,
      paymentSource: 'webhook',
      receiptNumber: receiptNumber,
      notes: notes || `Payment received for house ${houseNumber}`
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
      message: 'Payment received and recorded successfully',
      payment: populatedPayment,
      receiptNumber: receiptNumber
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Search house by number
router.get('/search/house/:houseNumber', async (req, res) => {
  try {
    const house = await House.findOne({ houseNumber: req.params.houseNumber })
      .populate('apartment', 'name address')
      .populate('tenant', 'firstName lastName email phone');

    if (!house) {
      return res.status(404).json({ message: 'House not found' });
    }

    res.json({
      house: {
        _id: house._id,
        houseNumber: house.houseNumber,
        apartment: house.apartment,
        tenant: house.tenant,
        rentAmount: house.rentAmount,
        status: house.status
      },
      canReceivePayment: !!house.tenant
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Check and update overdue payments
// Get analytics data
router.get('/analytics/revenue-trend', async (req, res) => {
  try {
    const { months = 6 } = req.query;
    const data = [];
    const now = new Date();
    
    for (let i = parseInt(months) - 1; i >= 0; i--) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const year = date.getFullYear();
      
      const payments = await Payment.find({
        year,
        month,
        status: 'paid'
      });
      
      const revenue = payments.reduce((sum, p) => sum + (p.paidAmount || p.amount || 0), 0);
      
      data.push({
        label: date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        value: revenue,
        month,
        year
      });
    }
    
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get payment status analytics
router.get('/analytics/payment-status', async (req, res) => {
  try {
    const { months = 6 } = req.query;
    const data = [];
    const now = new Date();
    
    for (let i = parseInt(months) - 1; i >= 0; i--) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const year = date.getFullYear();
      
      const payments = await Payment.find({ year, month });
      
      const paid = payments
        .filter(p => p.status === 'paid')
        .reduce((sum, p) => sum + (p.paidAmount || p.amount || 0), 0);
      
      const pending = payments
        .filter(p => p.status === 'pending')
        .reduce((sum, p) => sum + (p.expectedAmount || p.amount || 0), 0);
      
      const overdue = payments
        .filter(p => p.status === 'overdue')
        .reduce((sum, p) => sum + (p.expectedAmount || p.amount || 0), 0);
      
      data.push({
        label: date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        paid,
        pending,
        overdue,
        month,
        year
      });
    }
    
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post('/check-overdue', async (req, res) => {
  try {
    const { lateFeePercentage = 5, gracePeriodDays = 5 } = req.body;
    
    const today = new Date();
    const payments = await Payment.find({
      status: { $in: ['pending', 'partial'] }
    }).populate('house');

    let updatedCount = 0;
    const updatedPayments = [];

    for (const payment of payments) {
      const dueDate = new Date(payment.dueDate);
      const lateFeeDate = new Date(dueDate);
      lateFeeDate.setDate(lateFeeDate.getDate() + gracePeriodDays);

      if (today > lateFeeDate && payment.status !== 'overdue') {
        // Calculate late fee if not already set
        if (payment.lateFee === 0 && payment.house) {
          payment.lateFee = (payment.house.rentAmount * lateFeePercentage) / 100;
        }
        payment.status = 'overdue';
        await payment.save();
        updatedCount++;
        updatedPayments.push(payment);
      }
    }

    res.json({
      message: `Updated ${updatedCount} payments to overdue`,
      updated: updatedCount,
      payments: updatedPayments
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;
