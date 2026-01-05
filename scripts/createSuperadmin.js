import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import User from '../models/User.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = join(__dirname, '..', '.env');
dotenv.config({ path: envPath });

const createSuperadmin = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/rent_management');
    console.log('Connected to MongoDB');

    const username = process.argv[2] || 'admin';
    const email = process.argv[3] || 'admin@rentmanagement.com';
    const password = process.argv[4] || 'admin123';

    // Check if superadmin already exists
    const existingAdmin = await User.findOne({ role: 'superadmin' });
    if (existingAdmin) {
      console.log('Superadmin already exists:', existingAdmin.email);
      console.log('To create a new one, delete the existing superadmin first.');
      process.exit(0);
    }

    // Create superadmin
    const superadmin = new User({
      username,
      email,
      password,
      role: 'superadmin',
      firstName: 'Super',
      lastName: 'Admin',
      isActive: true
    });

    await superadmin.save();
    console.log('✅ Superadmin created successfully!');
    console.log('Username:', username);
    console.log('Email:', email);
    console.log('Password:', password);
    console.log('\n⚠️  Please change the password after first login!');
    
    process.exit(0);
  } catch (error) {
    console.error('Error creating superadmin:', error);
    process.exit(1);
  }
};

createSuperadmin();

