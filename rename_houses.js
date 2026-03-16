import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Apartment from './models/Apartment.js';
import House from './models/House.js';

dotenv.config();

async function renameHouses() {
  try {
    const uri = process.env.MONGODB_URI;
    console.log('Connecting to MongoDB...');
    await mongoose.connect(uri);
    
    const apartment = await Apartment.findOne({ name: /Dansu 2011/i });
    if (!apartment) {
      console.log('Apartment not found');
      process.exit(1);
    }
    console.log('Found Apartment:', apartment.name, apartment._id);
    
    const houses = await House.find({ apartment: apartment._id }).sort({ houseNumber: 1 });
    console.log('Found', houses.length, 'houses');
    
    let count = 1;
    for (const house of houses) {
      const oldNumber = house.houseNumber;
      const newNumber = String(count++);
      
      console.log('Renaming', oldNumber, 'to', newNumber);
      house.houseNumber = newNumber;
      await house.save();
    }
    
    console.log('Successfully renamed all houses');
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

renameHouses();
