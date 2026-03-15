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
  },
  // Automated Rent Generation Settings
  automation: {
    rentGeneration: {
      enabled: {
        type: Boolean,
        default: false
      },
      dayOfMonth: {
        type: Number,
        default: 1,
        min: 1,
        max: 28 // Avoid issues with months that have fewer days
      },
      time: {
        type: String,
        default: '00:00', // Format: HH:mm (24-hour)
        validate: {
          validator: function(v) {
            return /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/.test(v);
          },
          message: 'Time must be in HH:mm format (24-hour)'
        }
      },
      lastGenerated: {
        month: String,
        year: Number
      }
    },
    lateFee: {
      enabled: {
        type: Boolean,
        default: false
      },
      gracePeriodDays: {
        type: Number,
        default: 5,
        min: 0
      },
      calculationMethod: {
        type: String,
        enum: ['percentage', 'fixed'],
        default: 'percentage'
      },
      percentage: {
        type: Number,
        default: 5,
        min: 0,
        max: 100
      },
      fixedAmount: {
        type: Number,
        default: 0,
        min: 0
      },
      checkFrequency: {
        type: String,
        enum: ['daily', 'hourly'],
        default: 'daily'
      }
    }
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

