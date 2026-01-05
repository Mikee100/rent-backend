import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Apartment from '../models/Apartment.js';
import House from '../models/House.js';

dotenv.config();

// Generate houses for each apartment (30 houses per apartment)
function generateHouses(apartmentId, apartmentName) {
  const houses = [];
  const floors = 5; // 5 floors
  const housesPerFloor = 6; // 6 houses per floor
  
  for (let floor = 1; floor <= floors; floor++) {
    for (let unit = 1; unit <= housesPerFloor; unit++) {
      const houseNumber = `${floor}${String(unit).padStart(2, '0')}`;
      const bedrooms = floor <= 2 ? 1 : floor <= 4 ? 2 : 3;
      const bathrooms = bedrooms === 1 ? 1 : bedrooms === 2 ? 1 : 2;
      const baseRent = 800 + (bedrooms * 200) + (floor * 50);
      
      houses.push({
        apartment: apartmentId,
        houseNumber: houseNumber,
        floor: floor,
        bedrooms: bedrooms,
        bathrooms: bathrooms,
        rentAmount: baseRent,
        status: 'available',
        description: `${bedrooms} bedroom, ${bathrooms} bathroom unit on floor ${floor}`,
        amenities: ['Parking', 'AC', floor >= 3 ? 'Balcony' : null].filter(Boolean)
      });
    }
  }
  
  return houses;
}

async function seedHouses() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/rent_management');
    console.log('Connected to MongoDB');

    // Get all existing apartments
    const apartments = await Apartment.find();
    console.log(`Found ${apartments.length} apartments\n`);

    if (apartments.length === 0) {
      console.log('No apartments found. Please seed apartments first.');
      process.exit(1);
    }

    let totalHousesCreated = 0;

    // Create houses for each apartment
    for (const apartment of apartments) {
      // Check existing houses for this apartment
      const existingHouses = await House.find({ apartment: apartment._id });
      const existingCount = existingHouses.length;
      
      if (existingCount >= 30) {
        console.log(`✓ ${apartment.name}: Already has ${existingCount} houses (skipping)`);
        continue;
      }

      // Get existing house numbers to avoid duplicates
      const existingHouseNumbers = new Set(existingHouses.map(h => h.houseNumber));
      
      // Generate houses for this apartment
      const housesData = generateHouses(apartment._id, apartment.name);
      
      // Filter out houses that already exist
      const newHouses = housesData.filter(house => !existingHouseNumbers.has(house.houseNumber));
      
      if (newHouses.length > 0) {
        await House.insertMany(newHouses);
        const newCount = newHouses.length;
        totalHousesCreated += newCount;
        
        // Update apartment totalHouses count
        const updatedCount = existingCount + newCount;
        await Apartment.findByIdAndUpdate(apartment._id, {
          totalHouses: updatedCount
        });
        
        console.log(`✓ ${apartment.name}: Created ${newCount} houses (total: ${updatedCount})`);
      } else {
        console.log(`✓ ${apartment.name}: All houses already exist (${existingCount} houses)`);
      }
    }

    console.log('\n✅ Houses seeding completed!');
    console.log(`   - ${totalHousesCreated} new houses created`);
    console.log(`   - ${apartments.length} apartments processed`);
    
    process.exit(0);
  } catch (error) {
    console.error('Error seeding houses:', error);
    process.exit(1);
  }
}

seedHouses();

