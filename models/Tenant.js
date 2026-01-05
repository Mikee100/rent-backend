import mongoose from 'mongoose';

const tenantSchema = new mongoose.Schema({
  firstName: {
    type: String,
    required: true,
    trim: true
  },
  lastName: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true
  },
  phone: {
    type: String,
    required: true,
    trim: true
  },
  bankAccountNumber: {
    type: String,
    trim: true,
    sparse: true,
    index: true
  },
  bankName: {
    type: String,
    trim: true,
    default: 'Equity'
  },
  house: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'House',
    default: null
  },
  leaseStartDate: {
    type: Date,
    required: true
  },
  leaseEndDate: {
    type: Date,
    required: true
  },
  emergencyContact: {
    name: String,
    phone: String
  },
  status: {
    type: String,
    enum: ['active', 'inactive', 'past'],
    default: 'active'
  },
  documents: [{
    type: {
      type: String,
      enum: ['id', 'lease', 'contract', 'other']
    },
    name: String,
    url: String,
    uploadedDate: {
      type: Date,
      default: Date.now
    }
  }],
  communicationLog: [{
    date: {
      type: Date,
      default: Date.now
    },
    type: {
      type: String,
      enum: ['email', 'phone', 'in_person', 'other']
    },
    subject: String,
    notes: String,
    createdBy: String
  }],
  houseMoveHistory: [{
    fromHouse: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'House'
    },
    toHouse: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'House'
    },
    fromApartment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Apartment'
    },
    toApartment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Apartment'
    },
    moveDate: {
      type: Date,
      default: Date.now
    },
    reason: String,
    notes: String
  }]
}, {
  timestamps: true
});

export default mongoose.model('Tenant', tenantSchema);

