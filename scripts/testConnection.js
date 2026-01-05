import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

async function testConnection() {
  const uri = process.env.MONGODB_URI;
  
  console.log('Testing MongoDB Connection...\n');
  console.log('Connection String (password hidden):');
  if (uri) {
    const hiddenUri = uri.replace(/:[^:@]+@/, ':****@');
    console.log(hiddenUri);
  } else {
    console.log('❌ MONGODB_URI is not set in .env file!');
    process.exit(1);
  }
  
  console.log('\nAttempting to connect...\n');

  try {
    await mongoose.connect(uri);
    console.log('✅ Successfully connected to MongoDB!');
    
    // List databases
    const admin = mongoose.connection.db.admin();
    const dbs = await admin.listDatabases();
    console.log('\nAvailable databases:');
    dbs.databases.forEach(db => {
      console.log(`  - ${db.name} (${(db.sizeOnDisk / 1024 / 1024).toFixed(2)} MB)`);
    });
    
    // Check if rent_management database exists
    const dbExists = dbs.databases.some(db => db.name === 'rent_management');
    if (dbExists) {
      console.log('\n✅ Database "rent_management" exists!');
    } else {
      console.log('\n⚠️  Database "rent_management" does not exist yet (will be created automatically)');
    }
    
    await mongoose.connection.close();
    console.log('\n✅ Connection test successful!');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Connection failed!');
    console.error('\nError details:');
    console.error(error.message);
    
    if (error.message.includes('authentication failed')) {
      console.error('\n💡 Tip: Check your username and password in the connection string');
      console.error('   Make sure special characters in password are URL encoded');
    } else if (error.message.includes('ECONNREFUSED') || error.message.includes('ENOTFOUND')) {
      console.error('\n💡 Tip: Check your network access settings in MongoDB Atlas');
      console.error('   Make sure your IP address is whitelisted');
    } else if (error.message.includes('bad auth')) {
      console.error('\n💡 Tip: Verify your database user credentials');
    }
    
    process.exit(1);
  }
}

testConnection();

