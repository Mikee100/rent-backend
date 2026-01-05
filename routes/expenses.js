import express from 'express';
import Expense from '../models/Expense.js';
import Apartment from '../models/Apartment.js';
import House from '../models/House.js';
import { authenticate, filterByApartment, authorize } from '../middleware/auth.js';
import { logActivity } from '../middleware/activityLogger.js';

const router = express.Router();

// Get all expenses
router.get('/', authenticate, filterByApartment, logActivity({
  action: 'view',
  entityType: 'expense',
  description: (req) => {
    const role = req.user?.role || 'user';
    return `[${role.toUpperCase()}] Viewed expenses list`;
  }
}), async (req, res) => {
  try {
    const { apartment, house, category, startDate, endDate } = req.query;
    const query = {};
    
    // Apply apartment filter for caretakers
    if (req.apartmentFilter) {
      query.apartment = req.apartmentFilter.apartment;
    } else if (apartment) {
      query.apartment = apartment;
    }
    
    if (house) query.house = house;
    if (category) query.category = category;
    
    if (startDate || endDate) {
      query.expenseDate = {};
      if (startDate) query.expenseDate.$gte = new Date(startDate);
      if (endDate) query.expenseDate.$lte = new Date(endDate);
    }

    const expenses = await Expense.find(query)
      .populate('apartment', 'name address')
      .populate('house', 'houseNumber')
      .populate('maintenanceRequest', 'title description')
      .sort({ expenseDate: -1 });
    res.json(expenses);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get single expense
router.get('/:id', authenticate, filterByApartment, async (req, res) => {
  try {
    const expense = await Expense.findById(req.params.id)
      .populate('apartment')
      .populate('house')
      .populate('maintenanceRequest');
    if (!expense) {
      return res.status(404).json({ message: 'Expense not found' });
    }

    // Check if caretaker can access this expense
    if (req.user.role === 'caretaker' && req.user.apartment && expense.apartment) {
      const apartmentId = req.user.apartment._id || req.user.apartment;
      const expenseApartmentId = expense.apartment._id || expense.apartment;
      if (apartmentId.toString() !== expenseApartmentId.toString()) {
        return res.status(403).json({ message: 'Access denied.' });
      }
    }

    res.json(expense);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get expenses by apartment
router.get('/apartment/:apartmentId', authenticate, filterByApartment, async (req, res) => {
  try {
    // Check if caretaker can access this apartment
    if (req.user.role === 'caretaker' && req.user.apartment) {
      const apartmentId = req.user.apartment._id || req.user.apartment;
      if (req.params.apartmentId !== apartmentId.toString()) {
        return res.status(403).json({ message: 'Access denied.' });
      }
    }

    const expenses = await Expense.find({ apartment: req.params.apartmentId })
      .populate('house', 'houseNumber')
      .populate('maintenanceRequest', 'title')
      .sort({ expenseDate: -1 });
    res.json(expenses);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Create expense
router.post('/', async (req, res) => {
  try {
    const apartment = await Apartment.findById(req.body.apartment);
    if (!apartment) {
      return res.status(404).json({ message: 'Apartment not found' });
    }

    if (req.body.house) {
      const house = await House.findById(req.body.house);
      if (!house) {
        return res.status(404).json({ message: 'House not found' });
      }
    }

    const expense = new Expense(req.body);
    await expense.save();

    const populatedExpense = await Expense.findById(expense._id)
      .populate('apartment', 'name address')
      .populate('house', 'houseNumber')
      .populate('maintenanceRequest', 'title description');
    
    res.status(201).json(populatedExpense);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Update expense
router.put('/:id', async (req, res) => {
  try {
    const expense = await Expense.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    )
      .populate('apartment', 'name address')
      .populate('house', 'houseNumber')
      .populate('maintenanceRequest', 'title description');
    
    if (!expense) {
      return res.status(404).json({ message: 'Expense not found' });
    }
    res.json(expense);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Delete expense
router.delete('/:id', async (req, res) => {
  try {
    const expense = await Expense.findByIdAndDelete(req.params.id);
    if (!expense) {
      return res.status(404).json({ message: 'Expense not found' });
    }
    res.json({ message: 'Expense deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get expense summary
router.get('/summary/totals', authenticate, filterByApartment, async (req, res) => {
  try {
    const { apartment, startDate, endDate } = req.query;
    const query = {};
    
    // Apply apartment filter for caretakers
    if (req.apartmentFilter) {
      query.apartment = req.apartmentFilter.apartment;
    } else if (apartment) {
      query.apartment = apartment;
    }
    if (startDate || endDate) {
      query.expenseDate = {};
      if (startDate) query.expenseDate.$gte = new Date(startDate);
      if (endDate) query.expenseDate.$lte = new Date(endDate);
    }

    const expenses = await Expense.find(query);
    const total = expenses.reduce((sum, exp) => sum + exp.amount, 0);
    
    const byCategory = expenses.reduce((acc, exp) => {
      acc[exp.category] = (acc[exp.category] || 0) + exp.amount;
      return acc;
    }, {});

    res.json({ total, byCategory, count: expenses.length });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;

