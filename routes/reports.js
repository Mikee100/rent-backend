import express from 'express';
import Payment from '../models/Payment.js';
import Expense from '../models/Expense.js';
import Tenant from '../models/Tenant.js';
import House from '../models/House.js';
import Apartment from '../models/Apartment.js';
import { authenticate, filterByApartment, authorize } from '../middleware/auth.js';

const router = express.Router();

// Income Statement (Revenue vs Expenses)
router.get('/income-statement', authenticate, filterByApartment, async (req, res) => {
  try {
    const { startDate, endDate, apartmentId } = req.query;
    
    let paymentQuery = {};
    let expenseQuery = {};
    
    // Apply apartment filter
    if (req.apartmentFilter) {
      const houses = await House.find(req.apartmentFilter).select('_id');
      const houseIds = houses.map(h => h._id);
      paymentQuery.house = { $in: houseIds };
      expenseQuery.apartment = req.apartmentFilter._id;
    } else if (apartmentId) {
      const houses = await House.find({ apartment: apartmentId }).select('_id');
      const houseIds = houses.map(h => h._id);
      paymentQuery.house = { $in: houseIds };
      expenseQuery.apartment = apartmentId;
    }
    
    // Date range filter
    if (startDate || endDate) {
      paymentQuery.paymentDate = {};
      expenseQuery.expenseDate = {};
      if (startDate) {
        paymentQuery.paymentDate.$gte = new Date(startDate);
        expenseQuery.expenseDate.$gte = new Date(startDate);
      }
      if (endDate) {
        paymentQuery.paymentDate.$lte = new Date(endDate);
        expenseQuery.expenseDate.$lte = new Date(endDate);
      }
    }

    // Get caretaker house IDs to exclude
    const apartments = await Apartment.find({});
    const caretakerHouseIds = new Set(
      apartments.filter(a => a.caretakerHouse).map(a => a.caretakerHouse.toString())
    );

    // Get revenue (paid payments)
    const payments = await Payment.find({ ...paymentQuery, status: { $in: ['paid', 'partial'] } })
      .populate('house', 'houseNumber')
      .populate({
        path: 'house',
        populate: { path: 'apartment', select: 'name' }
      });
    
    // Filter out caretaker payments
    const validPayments = payments.filter(p => !p.house || !caretakerHouseIds.has(p.house._id.toString()));
    
    const revenue = validPayments.reduce((sum, p) => sum + (p.paidAmount || p.amount || 0), 0);
    const lateFees = validPayments.reduce((sum, p) => sum + (p.lateFee || 0), 0);
    const advanceCollections = validPayments.reduce((sum, p) => sum + (p.isAdvance ? (p.paidAmount || p.amount || 0) : 0), 0);
    const overpayments = validPayments.reduce((sum, p) => sum + (p.overpayment || 0), 0);
    
    // Get expenses
    const expenses = await Expense.find(expenseQuery)
      .populate('apartment', 'name');
    
    const totalExpenses = expenses.reduce((sum, e) => sum + (e.amount || 0), 0);
    
    // Group expenses by category
    const expensesByCategory = expenses.reduce((acc, expense) => {
      const category = expense.category || 'Other';
      acc[category] = (acc[category] || 0) + (expense.amount || 0);
      return acc;
    }, {});
    
    const netIncome = revenue + lateFees - totalExpenses;
    
    res.json({
      period: {
        startDate: startDate || null,
        endDate: endDate || null
      },
      revenue: {
        rent: revenue,
        lateFees: lateFees,
        advanceCollections: advanceCollections,
        overpayments: overpayments,
        total: revenue + lateFees
      },
      expenses: {
        total: totalExpenses,
        byCategory: expensesByCategory,
        items: expenses.map(e => ({
          id: e._id,
          date: e.expenseDate,
          description: e.description,
          category: e.category,
          amount: e.amount,
          apartment: e.apartment?.name
        }))
      },
      netIncome: netIncome,
      paymentCount: validPayments.length,
      expenseCount: expenses.length
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Tenant Ledger (Payment history for a tenant)
router.get('/tenant-ledger/:tenantId', authenticate, filterByApartment, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const { tenantId } = req.params;
    
    let query = { tenant: tenantId };
    
    // Apply apartment filter
    if (req.apartmentFilter) {
      const houses = await House.find(req.apartmentFilter).select('_id');
      const houseIds = houses.map(h => h._id);
      query.house = { $in: houseIds };
    }
    
    // Date range filter
    if (startDate || endDate) {
      query.paymentDate = {};
      if (startDate) query.paymentDate.$gte = new Date(startDate);
      if (endDate) query.paymentDate.$lte = new Date(endDate);
    }
    
    const payments = await Payment.find(query)
      .populate('house', 'houseNumber')
      .populate({
        path: 'house',
        populate: { path: 'apartment', select: 'name address' }
      })
      .sort({ paymentDate: -1 });
    
    const tenant = await Tenant.findById(tenantId)
      .populate('houses', 'houseNumber')
      .populate({
        path: 'houses',
        populate: { path: 'apartment', select: 'name' }
      });
    
    const totalPaid = payments.reduce((sum, p) => sum + (p.paidAmount || p.amount || 0), 0);
    const totalExpected = payments.reduce((sum, p) => sum + (p.expectedAmount || p.amount || 0), 0);
    const totalDeficit = payments.reduce((sum, p) => sum + (p.deficit || 0), 0);
    const totalLateFees = payments.reduce((sum, p) => sum + (p.lateFee || 0), 0);
    const totalOverpaid = payments.reduce((sum, p) => sum + (p.overpayment || 0), 0);
    
    // Calculate running balance
    let runningBalance = 0;
    const paymentsWithBalance = payments.map(payment => {
      const paid = payment.paidAmount || payment.amount || 0;
      const expected = payment.expectedAmount || payment.amount || 0;
      runningBalance += (expected - paid);
      return {
        ...payment.toObject(),
        runningBalance: runningBalance
      };
    });
    
    res.json({
      tenant: {
        id: tenant?._id,
        name: tenant ? `${tenant.firstName} ${tenant.lastName}` : 'N/A',
        email: tenant?.email,
        phone: tenant?.phone,
        house: tenant?.houses?.map(h => h.houseNumber).join(', '),
        apartment: tenant?.houses?.[0]?.apartment?.name
      },
      period: {
        startDate: startDate || null,
        endDate: endDate || null
      },
      summary: {
        totalPaid: totalPaid,
        totalExpected: totalExpected,
        totalDeficit: totalDeficit,
        totalLateFees: totalLateFees,
        totalOverpaid: totalOverpaid,
        currentBalance: runningBalance,
        paymentCount: payments.length
      },
      payments: paymentsWithBalance
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Outstanding Balances Report
router.get('/outstanding-balances', authenticate, filterByApartment, async (req, res) => {
  try {
    let paymentQuery = {};
    
    // Apply apartment filter
    if (req.apartmentFilter) {
      const houses = await House.find(req.apartmentFilter).select('_id');
      const houseIds = houses.map(h => h._id);
      paymentQuery.house = { $in: houseIds };
    }

    // Get all apartments to find caretaker houses
    const apartments = await (await import('../models/Apartment.js')).default.find({});
    const caretakerHouseIds = new Set(
      apartments.filter(a => a.caretakerHouse).map(a => a.caretakerHouse.toString())
    );

    // Get all tenants with payments
    const payments = await Payment.find(paymentQuery)
      .populate('tenant', 'firstName lastName email phone')
      .populate('house', 'houseNumber')
      .populate({
        path: 'house',
        populate: { path: 'apartment', select: 'name' }
      });
    
    // Group by tenant and house/month to prevent counting expectedAmount twice
    const tenantBalances = payments.reduce((acc, payment) => {
      const tenantId = payment.tenant?._id?.toString();
      if (!tenantId) return acc;
      
      const houseId = payment.house?._id?.toString() || 'unknown';
      if (caretakerHouseIds.has(houseId)) return acc; // Skip caretaker houses
      const monthYear = `${payment.month}-${payment.year}`;
      const periodKey = `${tenantId}-${houseId}-${monthYear}`;
      
      if (!acc[tenantId]) {
        acc[tenantId] = {
          tenant: payment.tenant,
          totalExpected: 0,
          totalPaid: 0,
          totalDeficit: 0,
          totalLateFees: 0,
          payments: [],
          processedPeriods: new Set()
        };
      }
      
      const expected = payment.expectedAmount || payment.amount || 0;
      const paid = payment.paidAmount || payment.amount || 0;
      const deficit = payment.deficit || 0;
      const lateFee = payment.lateFee || 0;
      
      // Only count expectedAmount once per house/month/tenant period
      if (!acc[tenantId].processedPeriods.has(periodKey)) {
        acc[tenantId].totalExpected += expected;
        acc[tenantId].processedPeriods.add(periodKey);
      }
      
      acc[tenantId].totalPaid += paid;
      acc[tenantId].totalDeficit += deficit;
      acc[tenantId].totalLateFees += lateFee;
      acc[tenantId].payments.push(payment);
      
      return acc;
    }, {});
    
    // Convert to array and calculate balances
    const balances = Object.values(tenantBalances)
      .map(tenant => ({
        ...tenant,
        currentBalance: tenant.totalExpected - tenant.totalPaid + tenant.totalLateFees,
        house: tenant.payments[0]?.house,
        apartment: tenant.payments[0]?.house?.apartment
      }))
      .filter(tenant => tenant.currentBalance > 0) // Only show tenants with outstanding balances
      .sort((a, b) => b.currentBalance - a.currentBalance);
    
    const totalOutstanding = balances.reduce((sum, t) => sum + t.currentBalance, 0);
    
    // Calculate totals by apartment
    const byApartment = balances.reduce((acc, b) => {
      const apartmentName = b.apartment?.name || 'Unknown';
      if (!acc[apartmentName]) {
        acc[apartmentName] = {
          apartmentName,
          totalOutstanding: 0,
          tenantCount: 0
        };
      }
      acc[apartmentName].totalOutstanding += b.currentBalance;
      acc[apartmentName].tenantCount += 1;
      return acc;
    }, {});

    res.json({
      totalOutstanding: totalOutstanding,
      tenantCount: balances.length,
      byApartment: Object.values(byApartment).sort((a, b) => b.totalOutstanding - a.totalOutstanding),
      balances: balances
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Revenue by Apartment
router.get('/revenue-by-apartment', authenticate, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    let paymentQuery = {};
    
    // Apply apartment filter for caretakers
    if (req.user.role === 'caretaker' && req.user.apartment) {
      const houses = await House.find({ apartment: req.user.apartment }).select('_id');
      const houseIds = houses.map(h => h._id);
      paymentQuery.house = { $in: houseIds };
    }
    
    // Date range filter
    if (startDate || endDate) {
      paymentQuery.paymentDate = {};
      if (startDate) paymentQuery.paymentDate.$gte = new Date(startDate);
      if (endDate) paymentQuery.paymentDate.$lte = new Date(endDate);
    }
    
    const payments = await Payment.find({ ...paymentQuery, status: { $in: ['paid', 'partial'] } })
      .populate({
        path: 'house',
        populate: { path: 'apartment', select: 'name address' }
      });
    
    // Get caretaker house IDs to exclude
    const apartments = await Apartment.find({});
    const caretakerHouseIds = new Set(
      apartments.filter(a => a.caretakerHouse).map(a => a.caretakerHouse.toString())
    );

    // Group by apartment
    const revenueByApartment = payments.reduce((acc, payment) => {
      const apartmentId = payment.house?.apartment?._id?.toString();
      const apartmentName = payment.house?.apartment?.name || 'Unknown';
      
      // Get the house ID - handle both populated and unpopulated cases for safety
      const houseId = (payment.house?._id || payment.house)?.toString();
      
      if (!apartmentId) return acc;
      
      // Skip caretaker houses from both revenue AND counts
      if (houseId && caretakerHouseIds.has(houseId)) return acc;
      
      if (!acc[apartmentId]) {
        acc[apartmentId] = {
          apartmentId: apartmentId,
          apartmentName: apartmentName,
          revenue: 0,
          lateFees: 0,
          paymentCount: 0,
          tenantCount: new Set()
        };
      }
      
      acc[apartmentId].revenue += (payment.paidAmount || payment.amount || 0);
      acc[apartmentId].lateFees += (payment.lateFee || 0);
      acc[apartmentId].paymentCount += 1;
      
      if (payment.tenant) {
        acc[apartmentId].tenantCount.add(payment.tenant.toString());
      }
      
      return acc;
    }, {});
    
    // Convert to array
    const revenue = Object.values(revenueByApartment).map(apt => ({
      ...apt,
      tenantCount: apt.tenantCount.size,
      total: apt.revenue + apt.lateFees
    })).sort((a, b) => b.total - a.total);
    
    const totalRevenue = revenue.reduce((sum, apt) => sum + apt.total, 0);
    
    res.json({
      period: {
        startDate: startDate || null,
        endDate: endDate || null
      },
      totalRevenue: totalRevenue,
      apartments: revenue
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Monthly apartment units report (per-unit status for a given month)
router.get('/monthly-apartment-units', authenticate, filterByApartment, async (req, res) => {
  try {
    const { apartmentId, month, year } = req.query;

    if (!month || !year) {
      return res.status(400).json({ message: 'Month and year are required' });
    }

    const monthNum = parseInt(month, 10);
    const yearNum = parseInt(year, 10);

    if (Number.isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
      return res.status(400).json({ message: 'Invalid month. Use 1-12.' });
    }

    if (Number.isNaN(yearNum)) {
      return res.status(400).json({ message: 'Invalid year.' });
    }

    const monthStr = String(monthNum).padStart(2, '0');

    // Determine target apartment
    let targetApartmentId = apartmentId || null;

    if (req.apartmentFilter && req.apartmentFilter.apartment) {
      const caretakersApartmentId = req.apartmentFilter.apartment;
      if (targetApartmentId && targetApartmentId !== caretakersApartmentId.toString()) {
        return res.status(403).json({
          message: 'Access denied. You can only view reports for your assigned apartment.'
        });
      }
      targetApartmentId = caretakersApartmentId.toString();
    }

    if (!targetApartmentId) {
      return res.status(400).json({ message: 'Apartment ID is required' });
    }

    const apartment = await Apartment.findById(targetApartmentId);
    if (!apartment) {
      return res.status(404).json({ message: 'Apartment not found' });
    }

    // Load all houses (units) for this apartment
    const houses = await House.find({ apartment: targetApartmentId })
      .populate('tenant', 'firstName lastName email phone')
      .sort({ houseNumber: 1 });

    const houseIds = houses.map((h) => h._id);

    // Load all payments for these houses for the given month/year
    const payments = await Payment.find({
      house: { $in: houseIds },
      month: monthStr,
      year: yearNum
    });

    // Group payments by house
    const paymentsByHouse = payments.reduce((acc, payment) => {
      const key = payment.house.toString();
      if (!acc[key]) acc[key] = [];
      acc[key].push(payment);
      return acc;
    }, {});

    const units = houses.map((house) => {
      const key = house._id.toString();
      const housePayments = paymentsByHouse[key] || [];
      const isCaretaker = apartment.caretakerHouse && apartment.caretakerHouse.toString() === key;

      let totalExpected = 0;
      let totalPaid = 0;
      let totalDeficit = 0;

      if (isCaretaker) {
        totalExpected = 0;
        totalPaid = 0;
        totalDeficit = 0;
      } else if (housePayments.length > 0) {
        totalExpected = housePayments[0].expectedAmount || housePayments[0].amount || 0;
        housePayments.forEach((p) => {
          const paid = typeof p.paidAmount === 'number' ? p.paidAmount : (p.amount || 0);
          totalPaid += paid;
        });
        totalDeficit = Math.max(0, totalExpected - totalPaid);
      } else {
        totalExpected = house.rentAmount || 0;
        totalPaid = 0;
        totalDeficit = totalExpected;
      }

      const unitAdvance = housePayments.reduce((sum, p) => sum + (p.isAdvance ? (p.paidAmount || p.amount || 0) : 0), 0);
      const unitOverpayment = housePayments.reduce((sum, p) => sum + (p.overpayment || 0), 0);

      return {
        houseId: house._id,
        houseNumber: house.houseNumber,
        tenantName: house.tenant ? `${house.tenant.firstName} ${house.tenant.lastName}` : null,
        rentAmount: isCaretaker ? 0 : house.rentAmount,
        totalExpected,
        totalPaid,
        totalDeficit,
        isCleared: totalDeficit <= 0,
        isCaretaker,
        totalAdvance: unitAdvance,
        totalOverpayment: unitOverpayment
      };
    });

    const summary = units.filter(u => !u.isCaretaker).reduce((acc, unit) => {
      acc.totalExpected += unit.totalExpected;
      acc.totalPaid += unit.totalPaid;
      acc.totalDeficit += unit.totalDeficit;
      acc.totalAdvance += (unit.totalAdvance || 0);
      acc.totalOverpayment += (unit.totalOverpayment || 0);
      return acc;
    }, { totalExpected: 0, totalPaid: 0, totalDeficit: 0, totalAdvance: 0, totalOverpayment: 0 });

    res.json({
      apartment: {
        id: apartment._id,
        name: apartment.name,
        address: apartment.address
      },
      period: {
        month: monthStr,
        year: yearNum
      },
      summary,
      units
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Apartment Financial History (Historical overview of rent collection)
router.get('/apartment-financial-history/:apartmentId', authenticate, filterByApartment, async (req, res) => {
  try {
    const { apartmentId } = req.params;
    
    // Check if caretaker can access this apartment
    if (req.user.role === 'caretaker' && req.user.apartment) {
      const userAptId = req.user.apartment._id || req.user.apartment;
      if (apartmentId !== userAptId.toString()) {
        return res.status(403).json({ message: 'Access denied. You can only view your assigned apartment.' });
      }
    }

    const apartment = await Apartment.findById(apartmentId);
    if (!apartment) {
      return res.status(404).json({ message: 'Apartment not found' });
    }

    const caretakerHouseId = apartment.caretakerHouse ? apartment.caretakerHouse.toString() : null;

    // Get all houses for this apartment to match payments easily
    const houses = await House.find({ apartment: apartmentId }).select('_id houseNumber');
    const houseIds = houses.map(h => h._id);

    // Get all payments for these houses
    const payments = await Payment.find({
      house: { $in: houseIds }
    }).sort({ year: -1, month: -1 });

    // Group by month and year
    const history = payments.reduce((acc, p) => {
      const houseId = p.house.toString();
      
      // EXCLUDE CARETAKER
      if (caretakerHouseId && houseId === caretakerHouseId) return acc;

      const key = `${p.year}-${p.month}`;
      if (!acc[key]) {
        acc[key] = {
          month: p.month,
          year: p.year,
          totalExpected: 0,
          totalPaid: 0,
          deficit: 0,
          paymentCount: 0
        };
      }

      // We only want to count expectedAmount once per house/month
      // Using a temporary set to track processed houses per month
      if (!acc[key].processedHouses) acc[key].processedHouses = new Set();
      
      if (!acc[key].processedHouses.has(houseId)) {
        acc[key].totalExpected += (p.expectedAmount || p.amount || 0);
        acc[key].processedHouses.add(houseId);
      }

      acc[key].totalPaid += (p.paidAmount || p.amount || 0);
      acc[key].deficit += (p.deficit || 0);
      acc[key].paymentCount += 1;

      return acc;
    }, {});

    // Convert to array and clean up temporary sets
    const sortedHistory = Object.values(history)
      .map(item => {
        delete item.processedHouses;
        return item;
      })
      .sort((a, b) => {
        if (a.year !== b.year) return b.year - a.year;
        return parseInt(b.month) - parseInt(a.month);
      });

    res.json(sortedHistory);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;

