import mongoose from 'mongoose';

const expenseSchema = new mongoose.Schema({
  apartment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Apartment',
    required: true
  },
  house: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'House',
    default: null
  },
  category: {
    type: String,
    enum: ['maintenance', 'repair', 'utilities', 'insurance', 'taxes', 'legal', 'marketing', 'supplies', 'other'],
    required: true
  },
  description: {
    type: String,
    required: true,
    trim: true
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  expenseDate: {
    type: Date,
    required: true,
    default: Date.now
  },
  vendor: {
    type: String,
    trim: true
  },
  paymentMethod: {
    type: String,
    enum: ['cash', 'check', 'bank_transfer', 'credit_card', 'other'],
    default: 'cash'
  },
  receipt: {
    type: String // URL to receipt file
  },
  notes: {
    type: String,
    trim: true
  },
  maintenanceRequest: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'MaintenanceRequest',
    default: null
  }
}, {
  timestamps: true
});

export default mongoose.model('Expense', expenseSchema);

