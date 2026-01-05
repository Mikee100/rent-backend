import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Apartment from '../models/Apartment.js';
import House from '../models/House.js';

dotenv.config();

const apartments = [
  {
    name: 'Sunset Apartments',
    address: '123 Main Street, City Center',
    description: 'Modern apartment complex with excellent amenities',
    manager: {
      name: 'John Smith',
      phone: '+1-555-0101',
      email: 'john@sunsetapts.com'
    }
  },
  {
    name: 'Riverside Complex',
    address: '456 River Road, Riverside',
    description: 'Luxury apartments with river views',
    manager: {
      name: 'Sarah Johnson',
      phone: '+1-555-0102',
      email: 'sarah@riverside.com'
    }
  },
  {
    name: 'Parkview Residences',
    address: '789 Park Avenue, Downtown',
    description: 'Family-friendly apartments near the park',
    manager: {
      name: 'Michael Brown',
      phone: '+1-555-0103',
      email: 'michael@parkview.com'
    }
  },
  {
    name: 'Garden Heights',
    address: '321 Garden Lane, Suburbia',
    description: 'Spacious apartments with beautiful gardens',
    manager: {
      name: 'Emily Davis',
      phone: '+1-555-0104',
      email: 'emily@gardenheights.com'
    }
  }
];

// Generate houses for each apartment (30 single-room units per apartment)
function generateHouses(apartmentId, apartmentName) {
  const houses = [];
  const totalUnits = 30;
  const baseRent = 800; // Base rent for single room units
  
  for (let unit = 1; unit <= totalUnits; unit++) {
    const houseNumber = String(unit).padStart(2, '0'); // 01, 02, ..., 30
    
    houses.push({
      apartment: apartmentId,
      houseNumber: houseNumber,
      rentAmount: baseRent,
      status: 'available',
      description: `Single room unit ${houseNumber}`,
      amenities: ['Parking', 'AC']
    });
  }
  
  return houses;
}

async function seedApartments() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/rent_management');
    console.log('Connected to MongoDB');

    // Clear existing data
    await House.deleteMany({});
    await Apartment.deleteMany({});
    console.log('Cleared existing apartments and houses');

    // Create apartments and houses
    for (const aptData of apartments) {
      const apartment = new Apartment(aptData);
      await apartment.save();
      console.log(`Created apartment: ${apartment.name}`);

      // Generate and create houses for this apartment
      const housesData = generateHouses(apartment._id, apartment.name);
      await House.insertMany(housesData);
      console.log(`  Created ${housesData.length} houses for ${apartment.name}`);

      // Update apartment totalHouses count
      apartment.totalHouses = housesData.length;
      await apartment.save();
    }

    console.log('\n✅ Seeded successfully!');
    console.log(`   - ${apartments.length} apartments created`);
    console.log(`   - ${apartments.length * 30} houses created (30 per apartment)`);
    
    process.exit(0);
  } catch (error) {
    console.error('Error seeding apartments:', error);
    process.exit(1);
  }
}

seedApartments();
