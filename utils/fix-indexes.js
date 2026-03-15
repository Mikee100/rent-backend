import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env') });

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/rent_management';

async function fixIndexes() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('Connected.');

    const db = mongoose.connection.db;
    const collection = db.collection('tenants');

    console.log('Listing current indexes on "tenants" collection:');
    const indexes = await collection.indexes();
    console.log(indexes);

    // Drop indexes that might be causing conflicts
    // Common names are email_1, phone_1, bankAccountNumber_1
    const indexesToDrop = ['email_1', 'phone_1', 'bankAccountNumber_1'];
    
    for (const indexName of indexesToDrop) {
      if (indexes.some(idx => idx.name === indexName)) {
        console.log(`Dropping index: ${indexName}`);
        await collection.dropIndex(indexName);
      }
    }

    console.log('Indexes dropped successfully. Mongoose will recreate them on next startup.');
    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('Error fixing indexes:', error);
    process.exit(1);
  }
}

fixIndexes();
