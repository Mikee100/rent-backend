import mongoose from 'mongoose';

// Apartment represents a building/complex
const apartmentSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  address: {
    type: String,
    required: true,
    trim: true
  },
  totalHouses: {
    type: Number,
    default: 0
  },
  description: {
    type: String,
    trim: true
  },
  manager: {
    name: String,
    phone: String,
    email: String
  },
  caretaker: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  }
}, {
  timestamps: true
});

export default mongoose.model('Apartment', apartmentSchema);
