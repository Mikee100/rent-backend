import express from 'express';
import Payment from '../models/Payment.js';
import Expense from '../models/Expense.js';
import Tenant from '../models/Tenant.js';
import House from '../models/House.js';
import Apartment from '../models/Apartment.js';
import MaintenanceRequest from '../models/MaintenanceRequest.js';
import { authenticate, filterByApartment, authorize } from '../middleware/auth.js';

const router = express.Router();

const parseMonthYear = (month, year) => {
  const monthNum = parseInt(month, 10);
  const yearNum = parseInt(year, 10);

  if (Number.isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
    return { error: 'Invalid month. Use 1-12.' };
  }
  if (Number.isNaN(yearNum) || yearNum < 1970) {
    return { error: 'Invalid year.' };
  }

  const monthStr = String(monthNum).padStart(2, '0');
  return { monthNum, yearNum, monthStr };
};

const monthRange = (monthNum, yearNum) => {
  const start = new Date(Date.UTC(yearNum, monthNum - 1, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(yearNum, monthNum, 1, 0, 0, 0, 0));
  return { start, end };
};

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

// Monthly Apartments Report (revenue + issues per apartment for a given month)
router.get('/apartments-monthly', authenticate, filterByApartment, async (req, res) => {
  try {
    const { month, year } = req.query;

    if (!month || !year) {
      return res.status(400).json({ message: 'Month and year are required' });
    }

    const parsed = parseMonthYear(month, year);
    if (parsed.error) {
      return res.status(400).json({ message: parsed.error });
    }

    const { monthNum, yearNum, monthStr } = parsed;
    const { start, end } = monthRange(monthNum, yearNum);

    // Determine which apartments are in-scope (caretakers: only their apartment)
    let apartmentsQuery = {};
    if (req.apartmentFilter && req.apartmentFilter.apartment) {
      apartmentsQuery = { _id: req.apartmentFilter.apartment };
    }

    const apartments = await Apartment.find(apartmentsQuery).select('_id name address caretakerHouse');
    const apartmentIds = apartments.map(a => a._id);

    // Map caretaker houses for exclusion
    const caretakerHouseIds = new Set(
      apartments
        .filter(a => a.caretakerHouse)
        .map(a => a.caretakerHouse.toString())
    );

    // Load all houses for in-scope apartments (for expected amounts + unit counts)
    const houses = await House.find({ apartment: { $in: apartmentIds } })
      .select('_id apartment houseNumber rentAmount')
      .sort({ houseNumber: 1 });
    const houseIds = houses.map((h) => h._id);

    // Payments for the month/year (all statuses) so we can compute expected vs paid
    const payments = await Payment.find({
      house: { $in: houseIds },
      month: monthStr,
      year: yearNum
    })
      .populate({
        path: 'house',
        select: 'houseNumber apartment rentAmount',
        populate: { path: 'apartment', select: 'name address caretakerHouse' }
      });

    // Cash received during the selected period (paymentDate-based) to capture advances for future months
    const cashReceived = await Payment.find({
      house: { $in: houseIds },
      paymentDate: { $gte: start, $lt: end },
      status: { $in: ['paid', 'partial'] }
    })
      .populate('tenant', 'firstName lastName')
      .populate({
        path: 'house',
        select: 'houseNumber apartment',
        populate: { path: 'apartment', select: 'name address caretakerHouse' }
      });

    // Group payments by house for unit-level computations
    const paymentsByHouse = payments.reduce((acc, p) => {
      const key = (p.house?._id || p.house)?.toString();
      if (!key) return acc;
      if (!acc[key]) acc[key] = [];
      acc[key].push(p);
      return acc;
    }, {});

    const isPaidLike = (p) => ['paid', 'partial'].includes(p.status);
    const isFutureOf = (p, monthStrRef, yearNumRef) => {
      const pYear = parseInt(p.year, 10);
      const pMonth = parseInt(p.month, 10);
      const refMonth = parseInt(monthStrRef, 10);
      if (Number.isNaN(pYear) || Number.isNaN(pMonth)) return false;
      if (pYear > yearNumRef) return true;
      if (pYear === yearNumRef && pMonth > refMonth) return true;
      return false;
    };

    // Fetch maintenance issues opened within the month
    const maintenanceQuery = {
      requestedDate: { $gte: start, $lt: end }
    };
    if (apartmentIds.length > 0 && apartmentsQuery._id) {
      maintenanceQuery.apartment = { $in: apartmentIds };
    }

    const issues = await MaintenanceRequest.find(maintenanceQuery)
      .populate('apartment', 'name address')
      .populate('house', 'houseNumber')
      .populate('tenant', 'firstName lastName');

    // Aggregate by apartment
    const byApartment = {};
    apartments.forEach((apt) => {
      byApartment[apt._id.toString()] = {
        apartmentId: apt._id,
        apartmentName: apt.name,
        address: apt.address,
        housesCount: 0,
        clearedHouses: 0,
        dueHouses: 0,
        totalExpected: 0,
        totalPaid: 0,
        outstanding: 0,
        overpaid: 0,
        advances: 0,
        revenue: 0, // alias of totalPaid for compatibility
        lateFees: 0,
        totalCollected: 0, // totalPaid + lateFees
        paymentCount: 0, // number of paid/partial payment records
        notes: [],
        advanceReceived: 0, // cash received during this period for future months
        advanceReceivedCount: 0,
        advanceReceivedItems: [],
        issues: {
          count: 0,
          totalCost: 0,
          byStatus: {},
          byPriority: {},
          byCategory: {},
          items: []
        }
      };
    });

    // Houses + payments → expected/paid/overpaid/outstanding + rollups
    houses.forEach((house) => {
      const houseId = house._id.toString();
      if (caretakerHouseIds.has(houseId)) return; // Exclude caretaker unit from billing totals

      const aptId = house.apartment.toString();
      if (!byApartment[aptId]) {
        byApartment[aptId] = {
          apartmentId: house.apartment,
          apartmentName: 'Unknown',
          address: null,
          housesCount: 0,
          clearedHouses: 0,
          dueHouses: 0,
          totalExpected: 0,
          totalPaid: 0,
          outstanding: 0,
          overpaid: 0,
          advances: 0,
          revenue: 0,
          lateFees: 0,
          totalCollected: 0,
          paymentCount: 0,
          notes: [],
          advanceReceived: 0,
          advanceReceivedCount: 0,
          advanceReceivedItems: [],
          issues: {
            count: 0,
            totalCost: 0,
            byStatus: {},
            byPriority: {},
            byCategory: {},
            items: []
          }
        };
      }

      const housePayments = paymentsByHouse[houseId] || [];
      const paidPayments = housePayments.filter(isPaidLike);

      const expected =
        (housePayments[0]?.expectedAmount ?? housePayments[0]?.amount ?? house.rentAmount ?? 0);

      const paid = paidPayments.reduce((sum, p) => sum + (p.paidAmount || p.amount || 0), 0);
      const lateFees = paidPayments.reduce((sum, p) => sum + (p.lateFee || 0), 0);
      const advances = paidPayments.reduce((sum, p) => sum + (p.isAdvance ? (p.paidAmount || p.amount || 0) : 0), 0);

      const explicitOverpaid = paidPayments.reduce((sum, p) => sum + (p.overpayment || 0), 0);
      const computedOverpaid = Math.max(0, paid - expected);
      const overpaid = Math.max(explicitOverpaid, computedOverpaid);
      const outstanding = Math.max(0, expected - paid);
      const isCleared = outstanding <= 0;

      const apt = byApartment[aptId];
      apt.housesCount += 1;
      apt.totalExpected += expected;
      apt.totalPaid += paid;
      apt.revenue += paid;
      apt.lateFees += lateFees;
      apt.totalCollected += (paid + lateFees);
      apt.paymentCount += paidPayments.length;
      apt.advances += advances;
      apt.overpaid += overpaid;
      apt.outstanding += outstanding;
      if (isCleared) apt.clearedHouses += 1;
      else apt.dueHouses += 1;
    });

    // Allocate "advance received" cash (future month payments received within this period)
    const validCashReceived = cashReceived.filter((p) => {
      const houseId = (p.house?._id || p.house)?.toString();
      if (!houseId) return false;
      if (caretakerHouseIds.has(houseId)) return false;
      return true;
    });

    validCashReceived.forEach((p) => {
      if (!isFutureOf(p, monthStr, yearNum) && !p.isAdvance) return;
      const aptId = p.house?.apartment?._id?.toString();
      if (!aptId || !byApartment[aptId]) return;

      const amt = p.paidAmount || p.amount || 0;
      byApartment[aptId].advanceReceived += amt;
      byApartment[aptId].advanceReceivedCount += 1;
      byApartment[aptId].advanceReceivedItems.push({
        paymentId: p._id,
        tenantName: p.tenant ? `${p.tenant.firstName} ${p.tenant.lastName}` : null,
        houseNumber: p.house?.houseNumber || null,
        forMonth: p.month,
        forYear: p.year,
        amount: amt
      });
    });

    // Issues → maintenance
    issues.forEach((i) => {
      const aptId = (i.apartment?._id || i.apartment)?.toString();
      if (!aptId) return;
      if (!byApartment[aptId]) {
        byApartment[aptId] = {
          apartmentId: i.apartment?._id || i.apartment,
          apartmentName: i.apartment?.name || 'Unknown',
          address: i.apartment?.address,
          housesCount: 0,
          clearedHouses: 0,
          dueHouses: 0,
          totalExpected: 0,
          totalPaid: 0,
          outstanding: 0,
          overpaid: 0,
          advances: 0,
          revenue: 0,
          lateFees: 0,
          totalCollected: 0,
          paymentCount: 0,
          notes: [],
          advanceReceived: 0,
          advanceReceivedCount: 0,
          advanceReceivedItems: [],
          issues: {
            count: 0,
            totalCost: 0,
            byStatus: {},
            byPriority: {},
            byCategory: {},
            items: []
          }
        };
      }

      const status = i.status || 'pending';
      const priority = i.priority || 'medium';
      const category = i.category || 'other';
      const cost = i.cost || 0;

      byApartment[aptId].issues.count += 1;
      byApartment[aptId].issues.totalCost += cost;
      byApartment[aptId].issues.byStatus[status] = (byApartment[aptId].issues.byStatus[status] || 0) + 1;
      byApartment[aptId].issues.byPriority[priority] = (byApartment[aptId].issues.byPriority[priority] || 0) + 1;
      byApartment[aptId].issues.byCategory[category] = (byApartment[aptId].issues.byCategory[category] || 0) + 1;

      byApartment[aptId].issues.items.push({
        id: i._id,
        title: i.title,
        category,
        priority,
        status,
        cost,
        requestedDate: i.requestedDate,
        completedDate: i.completedDate || null,
        houseNumber: i.house?.houseNumber || null,
        tenantName: i.tenant ? `${i.tenant.firstName} ${i.tenant.lastName}` : null
      });
    });

    // Build notes per apartment (similar to Monthly Houses PDF notes)
    Object.values(byApartment).forEach((apt) => {
      const notes = [];
      const periodLabel = `${monthStr}/${yearNum}`;

      notes.push(
        `This report summarizes rent performance for ${apt.housesCount} houses in ${apt.apartmentName} for ${periodLabel}.`
      );

      if (apt.clearedHouses > 0) {
        notes.push(`${apt.clearedHouses} house(s) are fully cleared for this period.`);
      }

      if ((apt.outstanding || 0) > 0 && apt.dueHouses > 0) {
        notes.push(
          `${apt.dueHouses} house(s) still have outstanding balances, contributing to the total outstanding shown above.`
        );
      } else if ((apt.totalExpected || 0) > 0 && (apt.outstanding || 0) === 0 && (apt.totalPaid || 0) >= (apt.totalExpected || 0)) {
        notes.push(`All rent for this period has been fully collected; there are no outstanding balances.`);
      }

      if ((apt.overpaid || 0) > 0) {
        notes.push(`Overpayments were recorded during this period and are reflected in the overpaid total shown above.`);
      }

      if ((apt.advances || 0) > 0) {
        notes.push(`Any advance payments or adjustments are reflected in the advances total where applicable.`);
      } else {
        notes.push(`Any advance payments or adjustments are reflected in individual house balances where applicable.`);
      }

      if ((apt.advanceReceived || 0) > 0) {
        notes.push(
          `Advance collections received this period (paid for future months): KSh ${(apt.advanceReceived || 0).toLocaleString()}.`
        );
      }

      notes.push(
        `Caretaker or management houses (if configured in the apartment settings) may be excluded from billing totals.`
      );

      apt.notes = notes;
    });

    const apartmentsReport = Object.values(byApartment)
      .map((a) => ({
        ...a,
        issues: {
          ...a.issues,
          items: a.issues.items.sort((x, y) => new Date(y.requestedDate) - new Date(x.requestedDate))
        }
      }))
      .sort((a, b) => (b.totalCollected || 0) - (a.totalCollected || 0));

    const totals = apartmentsReport.reduce((acc, a) => {
      acc.housesCount += a.housesCount || 0;
      acc.clearedHouses += a.clearedHouses || 0;
      acc.dueHouses += a.dueHouses || 0;
      acc.totalExpected += a.totalExpected || 0;
      acc.totalPaid += a.totalPaid || 0;
      acc.outstanding += a.outstanding || 0;
      acc.overpaid += a.overpaid || 0;
      acc.advances += a.advances || 0;
      acc.advanceReceived += a.advanceReceived || 0;
      acc.advanceReceivedCount += a.advanceReceivedCount || 0;
      acc.revenue += a.revenue || 0;
      acc.lateFees += a.lateFees || 0;
      acc.totalCollected += a.totalCollected || 0;
      acc.paymentCount += a.paymentCount || 0;
      acc.issuesCount += a.issues?.count || 0;
      acc.issuesCost += a.issues?.totalCost || 0;
      return acc;
    }, {
      housesCount: 0,
      clearedHouses: 0,
      dueHouses: 0,
      totalExpected: 0,
      totalPaid: 0,
      outstanding: 0,
      overpaid: 0,
      advances: 0,
      advanceReceived: 0,
      advanceReceivedCount: 0,
      revenue: 0,
      lateFees: 0,
      totalCollected: 0,
      paymentCount: 0,
      issuesCount: 0,
      issuesCost: 0
    });

    const portfolioNotes = [];
    const periodLabel = `${monthStr}/${yearNum}`;
    portfolioNotes.push(`This report summarizes rent performance for ${totals.housesCount} houses across all apartments for ${periodLabel}.`);
    if (totals.clearedHouses > 0) portfolioNotes.push(`${totals.clearedHouses} house(s) are fully cleared for this period.`);
    if ((totals.outstanding || 0) > 0 && totals.dueHouses > 0) {
      portfolioNotes.push(`${totals.dueHouses} house(s) still have outstanding balances, contributing to the total outstanding shown above.`);
    } else if ((totals.totalExpected || 0) > 0 && (totals.outstanding || 0) === 0 && (totals.totalPaid || 0) >= (totals.totalExpected || 0)) {
      portfolioNotes.push(`All rent for this period has been fully collected; there are no outstanding balances.`);
    }
    if ((totals.overpaid || 0) > 0) portfolioNotes.push(`Overpayments were recorded during this period and are reflected in the overpaid total shown above.`);
    portfolioNotes.push(`Any advance payments or adjustments are reflected in individual house balances where applicable.`);
    if ((totals.advanceReceived || 0) > 0) {
      portfolioNotes.push(
        `Advance collections received this period (paid for future months): KSh ${(totals.advanceReceived || 0).toLocaleString()}.`
      );

      const portfolioAdvanceItems = apartmentsReport
        .flatMap((a) => (Array.isArray(a.advanceReceivedItems) ? a.advanceReceivedItems.map((i) => ({
          ...i,
          apartmentName: a.apartmentName
        })) : []))
        .sort((a, b) => (b.amount || 0) - (a.amount || 0));

      if (portfolioAdvanceItems.length > 0) {
        const top = portfolioAdvanceItems.slice(0, 8).map((i) => {
          const apt = i.apartmentName || 'Apartment';
          const houseLabel = i.houseNumber ? `House ${i.houseNumber}` : 'House';
          const who = i.tenantName ? i.tenantName : 'Unknown tenant';
          const period = `${String(i.forMonth || '').padStart(2, '0')}/${i.forYear || ''}`;
          const amt = (i.amount || 0).toLocaleString();
          return `${apt} – ${houseLabel} (${who}): KSh ${amt} paid for ${period}.`;
        });
        portfolioNotes.push(`Advance details: ${top.join(' ')}`);
        if (portfolioAdvanceItems.length > top.length) {
          portfolioNotes.push(`(Showing ${top.length} of ${portfolioAdvanceItems.length} advance entries.)`);
        }
      }
    }
    portfolioNotes.push(`Caretaker or management houses (if configured in the apartment settings) may be excluded from billing totals.`);

    res.json({
      period: {
        month: monthStr,
        year: yearNum,
        startDate: start.toISOString(),
        endDate: end.toISOString()
      },
      totals,
      notes: portfolioNotes,
      apartments: apartmentsReport
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

    // Also load cash received during this period that was allocated to future months (advance)
    const { start, end } = monthRange(monthNum, yearNum);
    const cashReceived = await Payment.find({
      house: { $in: houseIds },
      paymentDate: { $gte: start, $lt: end },
      status: { $in: ['paid', 'partial'] }
    }).select('house month year paidAmount amount isAdvance status paymentDate');

    // Group payments by house
    const paymentsByHouse = payments.reduce((acc, payment) => {
      const key = payment.house.toString();
      if (!acc[key]) acc[key] = [];
      acc[key].push(payment);
      return acc;
    }, {});

    const houseMetaById = houses.reduce((acc, h) => {
      acc[h._id.toString()] = {
        houseNumber: h.houseNumber,
        tenantName: h.tenant ? `${h.tenant.firstName} ${h.tenant.lastName}` : null
      };
      return acc;
    }, {});

    const advanceReceivedItems = [];

    const advanceReceivedByHouse = cashReceived.reduce((acc, p) => {
      const houseKey = p.house?.toString();
      if (!houseKey) return acc;
      const isFuture = (parseInt(p.year, 10) > yearNum) ||
        (parseInt(p.year, 10) === yearNum && parseInt(p.month, 10) > monthNum);
      if (!p.isAdvance && !isFuture) return acc;
      const amt = p.paidAmount || p.amount || 0;
      acc[houseKey] = (acc[houseKey] || 0) + amt;

      const meta = houseMetaById[houseKey] || {};
      advanceReceivedItems.push({
        paymentId: p._id,
        houseId: p.house,
        houseNumber: meta.houseNumber || null,
        tenantName: meta.tenantName || null,
        forMonth: p.month,
        forYear: p.year,
        amount: amt
      });

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
      const advanceReceived = isCaretaker ? 0 : (advanceReceivedByHouse[key] || 0);

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
        totalOverpayment: unitOverpayment,
        advanceReceived
      };
    });

    const summary = units.filter(u => !u.isCaretaker).reduce((acc, unit) => {
      acc.totalExpected += unit.totalExpected;
      acc.totalPaid += unit.totalPaid;
      acc.totalDeficit += unit.totalDeficit;
      acc.totalAdvance += (unit.totalAdvance || 0);
      acc.totalOverpayment += (unit.totalOverpayment || 0);
      acc.advanceReceived += (unit.advanceReceived || 0);
      return acc;
    }, { totalExpected: 0, totalPaid: 0, totalDeficit: 0, totalAdvance: 0, totalOverpayment: 0, advanceReceived: 0 });

    summary.advanceReceivedItems = advanceReceivedItems
      .sort((a, b) => (b.amount || 0) - (a.amount || 0));

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

