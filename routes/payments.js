import express from 'express';
import Payment from '../models/Payment.js';
import Tenant from '../models/Tenant.js';
import House from '../models/House.js';
import Apartment from '../models/Apartment.js';
import { authenticate, filterByApartment, authorize } from '../middleware/auth.js';
import { logActivity } from '../middleware/activityLogger.js';
import { generateMonthlyRent } from '../services/rentGenerationService.js';

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
    const { months, amount: totalAmount, ...commonData } = req.body;
    
    // Normalize to an array of months if provided, otherwise use single month/year
    const monthList = months && Array.isArray(months) && months.length > 0 
      ? months 
      : [{ month: commonData.month, year: commonData.year }];
    
    // If houseNumber is provided, find the house
    let houseId = commonData.house;
    let tenantId = commonData.tenant;

    if (commonData.houseNumber && !houseId) {
      const house = await House.findOne({ houseNumber: commonData.houseNumber });
      if (!house) {
        return res.status(404).json({ message: `House with number ${commonData.houseNumber} not found` });
      }
      houseId = house._id;
      
      // If tenant is not provided but house has a tenant, use it
      if (!tenantId && house.tenant) {
        tenantId = house.tenant;
      }
    }

    // Get house to determine rent amount
    let house = null;
    if (houseId) {
      house = await House.findById(houseId);
    }

    if (!house) {
      return res.status(400).json({ message: 'House is required' });
    }

    const createdPayments = [];
    let remainingAmount = totalAmount || 0;
    
    // Sort months to ensure correct deficit carry-forward logic
    const sortedMonths = [...monthList].sort((a, b) => {
      const yearA = parseInt(a.year);
      const yearB = parseInt(b.year);
      if (yearA !== yearB) return yearA - yearB;
      return parseInt(a.month) - parseInt(b.month);
    });

    const baseCount = await Payment.countDocuments();

    const currentMonth = String(new Date().getMonth() + 1).padStart(2, '0');
    const currentYear = new Date().getFullYear();

    for (let i = 0; i < sortedMonths.length; i++) {
      const { month, year } = sortedMonths[i];
      const isAdvance = (parseInt(year) > currentYear) || (parseInt(year) === currentYear && parseInt(month) > parseInt(currentMonth));
      
      // Calculate expected amount (rent + any carried forward deficit)
      let carriedForward = 0;
      if (tenantId && month && year) {
        // Find previous month's payment to get deficit
        const prevMonth = parseInt(month) - 1;
        const prevYear = prevMonth === 0 ? parseInt(year) - 1 : parseInt(year);
        const prevMonthStr = prevMonth === 0 ? '12' : String(prevMonth).padStart(2, '0');
        
        const prevPayment = await Payment.findOne({
          tenant: tenantId,
          house: house._id,
          month: prevMonthStr,
          year: prevYear
        }).sort({ createdAt: -1 });

        if (prevPayment && prevPayment.deficit > 0) {
          carriedForward = prevPayment.deficit;
        }
      }

      const rentAmount = (house.apartment && 
                          house.apartment.caretakerHouse && 
                          house.apartment.caretakerHouse.toString() === house._id.toString()) ? 0 : house.rentAmount;
      const baseExpectedAmount = rentAmount + carriedForward;
      
      // Check if a payment record already exists for this month/year (e.g. auto-generated or previous partial)
      let existingPaymentRecord = await Payment.findOne({
        house: houseId,
        month,
        year: parseInt(year)
      });

      let paidAmountForThisMonth = 0;
      let overpaymentForThisMonth = 0;
      let finalExpectedAmount = baseExpectedAmount;

      if (sortedMonths.length === 1) {
        paidAmountForThisMonth = remainingAmount;
        // If single month and amount > expected, the remainder is overpayment
        if (remainingAmount > baseExpectedAmount) {
            overpaymentForThisMonth = remainingAmount - baseExpectedAmount;
        }
      } else {
        paidAmountForThisMonth = Math.min(remainingAmount, baseExpectedAmount);
        remainingAmount -= paidAmountForThisMonth;
        
        // If it's the last month and we still have money left, it's an overpayment
        if (i === sortedMonths.length - 1 && remainingAmount > 0) {
          overpaymentForThisMonth = remainingAmount;
          remainingAmount = 0;
        }
      }

      const totalPaidThisMonth = paidAmountForThisMonth + overpaymentForThisMonth;
      const paymentNotes = isAdvance ? `Advance payment for ${month}/${year}.` : `Payment for ${month}/${year}.`;
      const overpaymentNote = overpaymentForThisMonth > 0 ? ` (Includes overpayment of ${overpaymentForThisMonth})` : "";

      if (existingPaymentRecord) {
        // Update existing record
        const newPaidTotal = (existingPaymentRecord.paidAmount || 0) + paidAmountForThisMonth;
        const newOverpaymentTotal = (existingPaymentRecord.overpayment || 0) + overpaymentForThisMonth;
        finalExpectedAmount = existingPaymentRecord.expectedAmount || baseExpectedAmount;
        const newDeficit = Math.max(0, finalExpectedAmount - newPaidTotal);
        
        let status = 'pending';
        if (newPaidTotal >= finalExpectedAmount) {
          status = 'paid';
        } else if (newPaidTotal > 0) {
          status = 'partial';
        }

        existingPaymentRecord.paidAmount = newPaidTotal;
        existingPaymentRecord.overpayment = newOverpaymentTotal;
        existingPaymentRecord.amount = newPaidTotal + newOverpaymentTotal; 
        existingPaymentRecord.deficit = newDeficit;
        existingPaymentRecord.status = status;
        existingPaymentRecord.isAdvance = isAdvance;
        existingPaymentRecord.paymentDate = commonData.paymentDate || new Date();
        existingPaymentRecord.paymentMethod = commonData.paymentMethod || existingPaymentRecord.paymentMethod;
        existingPaymentRecord.notes = (existingPaymentRecord.notes ? existingPaymentRecord.notes + "\n" : "") + 
                                     (commonData.notes || `${paymentNotes}${overpaymentNote}`);
        
        if (commonData.transactionId) existingPaymentRecord.transactionId = commonData.transactionId;
        if (commonData.referenceNumber) existingPaymentRecord.referenceNumber = commonData.referenceNumber;
        
        await existingPaymentRecord.save();
        createdPayments.push(existingPaymentRecord._id);
      } else {
        // Create new record
        const deficit = Math.max(0, baseExpectedAmount - paidAmountForThisMonth);
        let status = 'pending';
        if (paidAmountForThisMonth >= baseExpectedAmount) {
          status = 'paid';
        } else if (paidAmountForThisMonth > 0) {
          status = 'partial';
        }

        let receiptNumber = commonData.receiptNumber;
        if (sortedMonths.length > 1) {
          receiptNumber = receiptNumber ? `${receiptNumber}-${i + 1}` : `RCP-${new Date().getFullYear()}-${String(baseCount + i + 1).padStart(6, '0')}`;
        } else if (!receiptNumber) {
          receiptNumber = `RCP-${new Date().getFullYear()}-${String(baseCount + 1).padStart(6, '0')}`;
        }

        const paymentData = {
          ...commonData,
          tenant: tenantId,
          house: houseId,
          month,
          year: parseInt(year),
          expectedAmount: baseExpectedAmount,
          paidAmount: paidAmountForThisMonth,
          overpayment: overpaymentForThisMonth,
          amount: totalPaidThisMonth,
          deficit: deficit,
          carriedForward: carriedForward,
          status: status,
          isAdvance: isAdvance,
          receiptNumber: receiptNumber,
          notes: (commonData.notes || `${paymentNotes}${overpaymentNote}`)
        };

        const payment = new Payment(paymentData);
        await payment.save();
        createdPayments.push(payment._id);
      }
    }

    const populatedPayments = await Payment.find({ _id: { $in: createdPayments } })
      .populate('tenant', 'firstName lastName email')
      .populate({
        path: 'house',
        populate: {
          path: 'apartment',
          select: 'name address'
        }
      });

    res.status(201).json(months ? populatedPayments : populatedPayments[0]);
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
router.post('/generate-monthly-rent', authenticate, authorize('superadmin', 'caretaker'), async (req, res) => {
  try {
    const { month, year, lateFeePercentage, gracePeriodDays } = req.body;
    
    const result = await generateMonthlyRent({
      month,
      year,
      lateFeePercentage,
      gracePeriodDays
    });

    if (result.success) {
      res.json({
        message: `Generated ${result.generated} payments`,
        generated: result.generated,
        errors: result.errors,
        details: result.details,
        month: result.month,
        year: result.year
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
        const transDate = new Date(TransTime);
        const amount = parseFloat(TransAmount);
        
        await processMultiMonthPayment({
          houseNumber: BillRefNumber.trim(),
          amount,
          transactionId: TransID,
          paymentDate: transDate,
          paymentMethod: 'mobile_money',
          paymentSource: 'paybill',
          receivedFrom: MSISDN || `${FirstName || ''} ${MiddleName || ''} ${LastName || ''}`.trim(),
          notes: `M-Pesa paybill payment received. TransID: ${TransID}`
        });

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

// Helper function to process multi-month payments (used by M-Pesa and Paybill)
async function processMultiMonthPayment({ houseNumber, amount, transactionId, paymentDate, paymentMethod, paymentSource, receivedFrom, notes }) {
  const house = await House.findOne({ houseNumber }).populate('tenant');
  if (!house || !house.tenant) {
    throw new Error(`House ${houseNumber} not found or has no tenant`);
  }

  const existingPayment = await Payment.findOne({ transactionId });
  if (existingPayment) {
    console.log(`Payment ${transactionId} already exists`);
    return;
  }

  let remainingAmount = amount;
  const currentMonth = String(new Date().getMonth() + 1).padStart(2, '0');
  const currentYear = new Date().getFullYear();
  
  let iterMonth = parseInt(currentMonth);
  let iterYear = currentYear;
  
  const processedPayments = [];
  const baseCount = await Payment.countDocuments();

  // Try to allocate to current and future months (up to 12 months ahead)
  for (let i = 0; i < 12 && remainingAmount > 0; i++) {
    const monthStr = String(iterMonth).padStart(2, '0');
    const isAdvance = (iterYear > currentYear) || (iterYear === currentYear && iterMonth > parseInt(currentMonth));
    
    let existingRecord = await Payment.findOne({
      house: house._id,
      month: monthStr,
      year: iterYear
    });

    let expectedAmount = house.rentAmount;
    let carriedForward = 0;
    
    // If no existing record, try to see if there was a deficit from previous
    if (!existingRecord) {
        const prevMonthVal = iterMonth - 1;
        const prevYearVal = prevMonthVal === 0 ? iterYear - 1 : iterYear;
        const prevMonthStr = prevMonthVal === 0 ? '12' : String(prevMonthVal).padStart(2, '0');
        
        const prevPayment = await Payment.findOne({
            house: house._id,
            month: prevMonthStr,
            year: prevYearVal
        }).sort({ createdAt: -1 });
        
        if (prevPayment && prevPayment.deficit > 0) {
            carriedForward = prevPayment.deficit;
        }
    } else {
        expectedAmount = existingRecord.expectedAmount || house.rentAmount;
        carriedForward = existingRecord.carriedForward || 0;
    }

    const totalNeeded = Math.max(0, expectedAmount - (existingRecord?.paidAmount || 0));
    
    if (totalNeeded <= 0 && isAdvance && i > 0) {
        // Already paid for this month, move to next
        iterMonth++;
        if (iterMonth > 12) {
            iterMonth = 1;
            iterYear++;
        }
        continue;
    }

    let paidForThisMonth = Math.min(remainingAmount, totalNeeded);
    let overpaymentForThisMonth = 0;

    // If it's the 12th month of checking or we are deep into the future, put all remainder as overpayment
    if (i === 11) {
        overpaymentForThisMonth = remainingAmount;
    } else {
        remainingAmount -= paidForThisMonth;
    }

    if (existingRecord) {
        existingRecord.paidAmount = (existingRecord.paidAmount || 0) + paidForThisMonth;
        existingRecord.overpayment = (existingRecord.overpayment || 0) + overpaymentForThisMonth;
        existingRecord.amount = (existingRecord.paidAmount) + (existingRecord.overpayment);
        existingRecord.deficit = Math.max(0, existingRecord.expectedAmount - existingRecord.paidAmount);
        existingRecord.status = existingRecord.paidAmount >= existingRecord.expectedAmount ? 'paid' : (existingRecord.paidAmount > 0 ? 'partial' : 'pending');
        existingRecord.paymentDate = paymentDate;
        existingRecord.paymentMethod = paymentMethod;
        existingRecord.transactionId = transactionId;
        existingRecord.paymentSource = paymentSource;
        existingRecord.isAdvance = isAdvance;
        existingRecord.notes = (existingRecord.notes ? existingRecord.notes + "\n" : "") + 
                              `${notes}. allocated ${paidForThisMonth}${overpaymentForThisMonth > 0 ? ` + ${overpaymentForThisMonth} overpayment` : ''}`;
        
        await existingRecord.save();
        processedPayments.push(existingRecord);
    } else {
        const receiptNumber = `RCP-${iterYear}-${String(baseCount + processedPayments.length + 1).padStart(6, '0')}`;
        const newPayment = new Payment({
            tenant: house.tenant._id,
            house: house._id,
            amount: paidForThisMonth + overpaymentForThisMonth,
            paidAmount: paidForThisMonth,
            overpayment: overpaymentForThisMonth,
            expectedAmount: expectedAmount,
            deficit: Math.max(0, expectedAmount - paidForThisMonth),
            carriedForward: carriedForward,
            paymentDate: paymentDate,
            dueDate: new Date(iterYear, iterMonth - 1, 1),
            paymentMethod: paymentMethod,
            status: paidForThisMonth >= expectedAmount ? 'paid' : (paidForThisMonth > 0 ? 'partial' : 'pending'),
            month: monthStr,
            year: iterYear,
            transactionId: transactionId,
            referenceNumber: transactionId,
            receivedFrom,
            houseNumber,
            paymentSource,
            receiptNumber,
            isAdvance,
            notes: `${notes}. allocated ${paidForThisMonth}${overpaymentForThisMonth > 0 ? ` + ${overpaymentForThisMonth} overpayment` : ''}`
        });
        await newPayment.save();
        processedPayments.push(newPayment);
    }

    if (remainingAmount <= 0) break;

    // Move to next month
    iterMonth++;
    if (iterMonth > 12) {
        iterMonth = 1;
        iterYear++;
    }
  }
  return processedPayments;
}

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

    const processedPayments = await processMultiMonthPayment({
      houseNumber: accountNumber.trim(),
      amount: parseFloat(amount),
      transactionId: transactionId || referenceNumber,
      paymentDate: new Date(),
      paymentMethod,
      paymentSource: 'paybill',
      receivedFrom: phoneNumber || 'Unknown',
      notes: notes || `Paybill payment received for house ${accountNumber}`
    });

    return res.status(200).json({
      message: 'Paybill payment processed successfully',
      payments: processedPayments,
      count: processedPayments.length
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

    const processedPayments = await processMultiMonthPayment({
      houseNumber: houseNumber.trim(),
      amount: parseFloat(amount),
      transactionId: transactionId || referenceNumber,
      paymentDate: new Date(),
      paymentMethod: paymentMethod || 'bank_transfer',
      paymentSource: 'api',
      receivedFrom: receivedFrom || 'External System',
      notes: notes || `External payment received via /receive`
    });

    res.json({
      message: 'Payment received successfully',
      payments: processedPayments,
      count: processedPayments.length
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

// Batch mark payments as paid
router.post('/batch-mark-paid', authenticate, authorize('superadmin', 'caretaker'), async (req, res) => {
  try {
    const { houseIds, month, year, paymentMethod = 'cash' } = req.body;
    
    if (!houseIds || !Array.isArray(houseIds) || houseIds.length === 0) {
      return res.status(400).json({ message: 'House IDs array is required' });
    }

    if (!month || !year) {
      return res.status(400).json({ message: 'Month and year are required' });
    }

    const results = {
      success: 0,
      failed: 0,
      errors: []
    };

    for (const houseId of houseIds) {
      try {
        const house = await House.findById(houseId).populate('tenant');
        if (!house || !house.tenant) {
          results.failed++;
          results.errors.push(`House ${houseId} or its tenant not found/inactive`);
          continue;
        }

        const apartment = await Apartment.findById(house.apartment);
        const isCaretaker = apartment?.caretakerHouse?.toString() === house._id.toString();

        // Calculate expected amount
        let carriedForward = 0;
        const prevMonth = parseInt(month) - 1;
        const prevYear = prevMonth === 0 ? parseInt(year) - 1 : parseInt(year);
        const prevMonthStr = prevMonth === 0 ? '12' : String(prevMonth).padStart(2, '0');
        
        const prevPayment = await Payment.findOne({
          tenant: house.tenant._id,
          house: house._id,
          month: prevMonthStr,
          year: prevYear
        }).sort({ createdAt: -1 });

        if (prevPayment && prevPayment.deficit > 0) {
          carriedForward = prevPayment.deficit;
        }

        const rentAmount = isCaretaker ? 0 : (house.rentAmount || 0);
        const expectedAmount = rentAmount + carriedForward;

        // Find or create payment for target month
        let payment = await Payment.findOne({
          tenant: house.tenant._id,
          house: house._id,
          month: month,
          year: year
        });

        if (payment) {
          // Update existing
          payment.status = 'paid';
          payment.paidAmount = expectedAmount;
          payment.expectedAmount = expectedAmount;
          payment.deficit = 0;
          payment.paymentMethod = paymentMethod;
          payment.paymentDate = new Date();
        } else {
          // Create new
          const count = await Payment.countDocuments();
          const receiptNumber = `RCP-${year}-${String(count + 1).padStart(6, '0')}`;
          const dueDate = new Date(year, parseInt(month) - 1, 1);

          payment = new Payment({
            tenant: house.tenant._id,
            house: house._id,
            amount: expectedAmount,
            expectedAmount: expectedAmount,
            paidAmount: expectedAmount,
            deficit: 0,
            carriedForward: carriedForward,
            dueDate: dueDate,
            paymentDate: new Date(),
            month: month,
            year: year,
            status: 'paid',
            paymentMethod: paymentMethod,
            receiptNumber: receiptNumber,
            notes: 'Batch collection update'
          });
        }

        await payment.save();
        results.success++;
      } catch (error) {
        results.failed++;
        results.errors.push(`Error processing house ${houseId}: ${error.message}`);
      }
    }

    res.json({
      message: `Successfully processed ${results.success} payments. ${results.failed} failed.`,
      ...results
    });
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
