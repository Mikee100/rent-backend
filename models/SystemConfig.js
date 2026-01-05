import mongoose from 'mongoose';

const systemConfigSchema = new mongoose.Schema({
  paybillNumber: {
    type: String,
    trim: true,
    unique: true,
    sparse: true
  },
  businessName: {
    type: String,
    trim: true,
    default: 'Rent Management System'
  },
  paymentInstructions: {
    type: String,
    trim: true
  },
  mobileMoneyProvider: {
    type: String,
    enum: ['mpesa', 'mtn', 'airtel', 'orange', 'other'],
    default: 'mpesa'
  },
  bankAccount: {
    accountNumber: String,
    bankName: String,
    accountName: String
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Ensure only one config document exists
systemConfigSchema.statics.getConfig = async function() {
  let config = await this.findOne();
  if (!config) {
    config = await this.create({});
  }
  return config;
};

export default mongoose.model('SystemConfig', systemConfigSchema);

