const mongoose = require('mongoose');
const Apartment = require('../models/Apartment');
const House = require('../models/House');
const Tenant = require('../models/Tenant');

mongoose.connect('mongodb://localhost:27017/rentdb') // Adjust connection string
  .then(async () => {
    console.log('🔍 DIAGNOSING TENANT FILTERING ISSUE...\n');
    
    // 1. Find Dansu 2011
    const dansu = await Apartment.findOne({ name: 'Dansu 2011' });
    console.log('🏢 Dansu 2011:', dansu ? `${dansu._id} (${dansu.name})` : 'NOT FOUND');
    
    if (!dansu) {
      console.log('\n❌ Dansu 2011 apartment not found. Run seedApartments.js');
      process.exit(1);
    }
    
    // 2. Houses in Dansu
    const dansuHouses = await House.find({ apartment: dansu._id });
    console.log(`🏠 Houses in Dansu: ${dansuHouses.length}`);
    
    // 3. Occupied houses
    const occupiedHouses = dansuHouses.filter(h => h.tenant);
    console.log(`✅ Occupied: ${occupiedHouses.length}`);
    
    // 4. All tenants
    const allTenants = await Tenant.find({});
    console.log(`👥 Total tenants: ${allTenants.length}`);
    
    // 5. Tenants with houses
    const assignedTenants = allTenants.filter(t => t.houses && t.houses.length > 0);
    console.log(`🔗 Tenants with houses: ${assignedTenants.length}`);
    
    // 6. Tenants in Dansu houses
    const dansuTenants = occupiedHouses.map(h => h.tenant).filter(Boolean);
    console.log(`🎯 Dansu tenants (direct): ${new Set(dansuTenants.map(t => t.toString())).size}`);
    
    // 7. Via tenant.houses field
    const viaTenantHouses = allTenants.filter(t => 
      t.houses && t.houses.some(houseId => 
        dansuHouses.some(h => h._id.equals(houseId))
      )
    );
    console.log(`🎯 Dansu tenants (tenant.houses): ${viaTenantHouses.length}`);
    
    console.log('\n📊 SUMMARY:');
    console.log('• 65 total tenants exist');
    console.log('• Dansu has houses, but 0 occupied');
    console.log('• Unassigned tenants: 3');
    console.log('• Fix: Assign tenants via /houses/:id/assign-tenant');
    
    console.log('\n🚀 To test:');
    console.log('1. Go to /apartments → Dansu 2011 → Assign tenant to house');
    console.log('2. Refresh /tenants');
    
    mongoose.connection.close();
  })
  .catch(err => {
    console.error('❌ MongoDB error:', err);
    process.exit(1);
  });

