import mongoose from 'mongoose';

// House represents an individual unit within an apartment building
const houseSchema = new mongoose.Schema({
  apartment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Apartment',
    required: true
  },
  houseNumber: {
    type: String,
    required: true,
    trim: true
  },
  rentAmount: {
    type: Number,
    required: true,
    min: 0
  },
  status: {
    type: String,
    enum: ['available', 'occupied', 'maintenance'],
    default: 'available'
  },
  description: {
    type: String,
    trim: true
  },
  amenities: [{
    type: String
  }],
  tenant: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    default: null
  },
  photos: [{
    type: String // URLs to photos
  }]
}, {
  timestamps: true
});

// Compound index to ensure unique house numbers per apartment
houseSchema.index({ apartment: 1, houseNumber: 1 }, { unique: true });

export default mongoose.model('House', houseSchema);


