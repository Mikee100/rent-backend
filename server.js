import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import apartmentRoutes from './routes/apartments.js';
import houseRoutes from './routes/houses.js';
import tenantRoutes from './routes/tenants.js';
import paymentRoutes from './routes/payments.js';
import maintenanceRoutes from './routes/maintenance.js';
import expenseRoutes from './routes/expenses.js';
import configRoutes from './routes/config.js';
import mpesaRoutes from './routes/mpesa.js';
import equityBankRoutes from './routes/equityBank.js';
import authRoutes from './routes/auth.js';
import reportsRoutes from './routes/reports.js';
import activityLogsRoutes from './routes/activityLogs.js';

// Get current directory for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env file from backend directory
const envPath = join(__dirname, '.env');
dotenv.config({ path: envPath });

// Debug: Log if .env file was loaded
console.log('Environment file path:', envPath);
console.log('MPESA_ENV:', process.env.MPESA_ENV || 'NOT SET');
console.log('JWT_SECRET:', process.env.JWT_SECRET ? 'SET (' + process.env.JWT_SECRET.substring(0, 10) + '...)' : 'NOT SET');

// Check M-Pesa configuration on startup (warn but don't fail)
const mpesaConfig = {
  consumerKey: process.env.MPESA_CONSUMER_KEY,
  consumerSecret: process.env.MPESA_CONSUMER_SECRET,
  shortcode: process.env.MPESA_SHORTCODE,
  passkey: process.env.MPESA_PASSKEY,
  callbackUrl: process.env.MPESA_CALLBACK_URL,
  env: process.env.MPESA_ENV
};

const missingMpesaConfig = [];
// Check for undefined, null, or empty string (after trim)
if (!mpesaConfig.consumerKey || !mpesaConfig.consumerKey.trim()) missingMpesaConfig.push('MPESA_CONSUMER_KEY');
if (!mpesaConfig.consumerSecret || !mpesaConfig.consumerSecret.trim()) missingMpesaConfig.push('MPESA_CONSUMER_SECRET');
if (!mpesaConfig.shortcode || !String(mpesaConfig.shortcode).trim()) missingMpesaConfig.push('MPESA_SHORTCODE');
if (!mpesaConfig.passkey || !mpesaConfig.passkey.trim()) missingMpesaConfig.push('MPESA_PASSKEY');
if (!mpesaConfig.callbackUrl || !mpesaConfig.callbackUrl.trim()) missingMpesaConfig.push('MPESA_CALLBACK_URL');

if (missingMpesaConfig.length > 0) {
  console.warn('\n⚠️  M-Pesa Configuration Missing:');
  console.warn('   The following environment variables are not set or are empty:');
  missingMpesaConfig.forEach(v => console.warn(`   - ${v}`));
  console.warn('\n   M-Pesa STK Push features will not work until these are configured.');
  console.warn('   Add them to your backend/.env file. See MPESA_SETUP.md for setup instructions.\n');
} else {
  console.log('✅ M-Pesa configuration found');
}

const app = express();
const PORT = process.env.PORT || 7000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/apartments', apartmentRoutes);
app.use('/api/houses', houseRoutes);
app.use('/api/tenants', tenantRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/maintenance', maintenanceRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/config', configRoutes);
app.use('/api/mpesa', mpesaRoutes);
app.use('/api/equity-bank', equityBankRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/activity-logs', activityLogsRoutes);
// Also support /mpesa routes (without /api prefix) for M-Pesa callbacks
app.use('/mpesa', mpesaRoutes);
// Also support /equity-bank routes (without /api prefix) for Equity Bank webhooks
app.use('/equity-bank', equityBankRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Rent Management API is running' });
});

// MongoDB connection
mongoose
  .connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/rent_management')
  .then(() => {
    console.log('Connected to MongoDB');
    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  })
  .catch((error) => {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  });

export default app;

