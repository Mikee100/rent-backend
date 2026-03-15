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

    // Get revenue (paid payments)
    const payments = await Payment.find({ ...paymentQuery, status: { $in: ['paid', 'partial'] } })
      .populate('house', 'houseNumber')
      .populate({
        path: 'house',
        populate: { path: 'apartment', select: 'name' }
      });
    
    const revenue = payments.reduce((sum, p) => sum + (p.paidAmount || p.amount || 0), 0);
    const lateFees = payments.reduce((sum, p) => sum + (p.lateFee || 0), 0);
    
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
      paymentCount: payments.length,
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
      .populate('house', 'houseNumber')
      .populate({
        path: 'house',
        populate: { path: 'apartment', select: 'name' }
      });
    
    const totalPaid = payments.reduce((sum, p) => sum + (p.paidAmount || p.amount || 0), 0);
    const totalExpected = payments.reduce((sum, p) => sum + (p.expectedAmount || p.amount || 0), 0);
    const totalDeficit = payments.reduce((sum, p) => sum + (p.deficit || 0), 0);
    const totalLateFees = payments.reduce((sum, p) => sum + (p.lateFee || 0), 0);
    
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
        house: tenant?.house?.houseNumber,
        apartment: tenant?.house?.apartment?.name
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
    
    // Get all tenants with payments
    const payments = await Payment.find(paymentQuery)
      .populate('tenant', 'firstName lastName email phone')
      .populate('house', 'houseNumber')
      .populate({
        path: 'house',
        populate: { path: 'apartment', select: 'name' }
      });
    
    // Group by tenant
    const tenantBalances = payments.reduce((acc, payment) => {
      const tenantId = payment.tenant?._id?.toString();
      if (!tenantId) return acc;
      
      if (!acc[tenantId]) {
        acc[tenantId] = {
          tenant: payment.tenant,
          totalExpected: 0,
          totalPaid: 0,
          totalDeficit: 0,
          totalLateFees: 0,
          payments: []
        };
      }
      
      const expected = payment.expectedAmount || payment.amount || 0;
      const paid = payment.paidAmount || payment.amount || 0;
      const deficit = payment.deficit || 0;
      const lateFee = payment.lateFee || 0;
      
      acc[tenantId].totalExpected += expected;
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
    
    res.json({
      totalOutstanding: totalOutstanding,
      tenantCount: balances.length,
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
    
    // Group by apartment
    const revenueByApartment = payments.reduce((acc, payment) => {
      const apartmentId = payment.house?.apartment?._id?.toString();
      const apartmentName = payment.house?.apartment?.name || 'Unknown';
      
      if (!apartmentId) return acc;
      
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

      let totalExpected = 0;
      let totalPaid = 0;
      let totalDeficit = 0;

      if (housePayments.length > 0) {
        housePayments.forEach((p) => {
          const expected = typeof p.expectedAmount === 'number' ? p.expectedAmount : (p.amount || 0);
          const paid = typeof p.paidAmount === 'number' ? p.paidAmount : (p.amount || 0);
          const deficit = typeof p.deficit === 'number' ? p.deficit : Math.max(0, expected - paid);

          totalExpected += expected;
          totalPaid += paid;
          totalDeficit += deficit;
        });
      } else {
        // No payment records for this month: expected is at least one month of rent
        totalExpected = house.rentAmount || 0;
        totalPaid = 0;
        totalDeficit = totalExpected;
      }

      const isCleared = totalDeficit <= 0.01;

      return {
        houseId: house._id,
        houseNumber: house.houseNumber,
        tenantName: house.tenant ? `${house.tenant.firstName} ${house.tenant.lastName}` : null,
        rentAmount: house.rentAmount,
        totalExpected,
        totalPaid,
        totalDeficit,
        isCleared
      };
    });

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
      units
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;

