import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

import Apartment from '../models/Apartment.js';
import House from '../models/House.js';
import Payment from '../models/Payment.js';
import Tenant from '../models/Tenant.js';

async function checkDansu() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    const apartment = await Apartment.findOne({ name: 'Dansu 2015' });
    if (!apartment) {
      console.log('Apartment "Dansu 2015" not found');
      return;
    }

    console.log('Apartment details:', {
      _id: apartment._id,
      name: apartment.name,
      caretakerHouse: apartment.caretakerHouse
    });

    const houses = await House.find({ apartment: apartment._id });
    console.log(`Found ${houses.length} houses for Dansu 2015:`);
    houses.forEach(h => {
        console.log(` - House: ${h.houseNumber}, ID: ${h._id}${h.houseNumber.toLowerCase().includes('caretaker') ? ' [MATCHES "caretaker"]' : ''}`);
    });

    const caretakerHouseByNum = houses.find(h => h.houseNumber.toLowerCase().includes('caretaker'));
    if (caretakerHouseByNum) {
        console.log(`\nPotential caretaker house found by number: ${caretakerHouseByNum.houseNumber} (${caretakerHouseByNum._id})`);
    }

    const caretakerHouse = houses.find(h => apartment.caretakerHouse && h._id.equals(apartment.caretakerHouse));
    if (caretakerHouse) {
      console.log('Caretaker house found via apartment.caretakerHouse:', {
        _id: caretakerHouse._id,
        houseNumber: caretakerHouse.houseNumber
      });
    } else {
      console.log('\nWARNING: Caretaker house NOT linked in Apartment model.');
      if (apartment.caretakerHouse) {
          console.log(`Expected caretaker house ID from Apartment metadata: ${apartment.caretakerHouse}`);
      }
    }

    const payments = await Payment.find({
      status: { $in: ['paid', 'partial'] }
    }).populate('house').populate('tenant');

    const dansuPayments = payments.filter(p => p.house && p.house.apartment && p.house.apartment.toString() === apartment._id.toString());
    
    console.log(`\nFound ${dansuPayments.length} paid/partial payments for Dansu 2015`);

    // Identify which houses have payments
    const housesWithPayments = new Set();
    dansuPayments.forEach(p => {
        housesWithPayments.add(p.house.houseNumber);
    });
    console.log(`Houses with payments: ${Array.from(housesWithPayments).sort().join(', ')}`);

    const caretakerHouseIdStr = apartment.caretakerHouse ? apartment.caretakerHouse.toString() : (caretakerHouseByNum ? caretakerHouseByNum._id.toString() : null);
    const caretakerPayments = dansuPayments.filter(p => (p.house._id || p.house).toString() === caretakerHouseIdStr);
    
    console.log(`\nFound ${caretakerPayments.length} payments for the caretaker house (${caretakerHouse ? caretakerHouse.houseNumber : (caretakerHouseByNum ? caretakerHouseByNum.houseNumber : 'N/A')})`);

    if (caretakerPayments.length > 0) {
        console.log('Caretaker payments details:');
        caretakerPayments.forEach(p => {
            console.log(` - Payment ID: ${p._id}, Amount: ${p.paidAmount || p.amount}, Tenant: ${p.tenant ? (p.tenant.firstName + ' ' + p.tenant.lastName) : 'Unknown'}`);
        });
    }

    // Count tenants
    const tenantIds = new Map();
    dansuPayments.forEach(p => {
      if (p.tenant) {
          const id = p.tenant._id.toString();
          const name = `${p.tenant.firstName} ${p.tenant.lastName}`;
          tenantIds.set(id, name);
      }
    });

    console.log(`\nMetrics INCLUDING Caretaker (Raw Data):`);
    console.log(`Total unique tenants: ${tenantIds.size}`);
    console.log('Tenant Names:', Array.from(tenantIds.values()).sort().join(', '));
    const totalRev = dansuPayments.reduce((sum, p) => sum + (p.paidAmount || p.amount || 0), 0);
    const totalLF = dansuPayments.reduce((sum, p) => sum + (p.lateFee || 0), 0);
    console.log(`Revenue: ${totalRev}`);
    console.log(`Late Fees: ${totalLF}`);
    console.log(`Grand Total: ${totalRev + totalLF}`);
    console.log(`Payments count: ${dansuPayments.length}`);

    const nonCaretakerPayments = dansuPayments.filter(p => (p.house._id || p.house).toString() !== caretakerHouseIdStr);
    const nonCaretakerRevenue = nonCaretakerPayments.reduce((sum, p) => sum + (p.paidAmount || p.amount || 0), 0);
    const nonCaretakerLateFees = nonCaretakerPayments.reduce((sum, p) => sum + (p.lateFee || 0), 0);
    const nonCaretakerTenantIds = new Set();
    nonCaretakerPayments.forEach(p => {
      if (p.tenant) nonCaretakerTenantIds.add(p.tenant.toString());
    });

    console.log('\nMetrics EXCLUDING Caretaker (Expected result):');
    console.log(`Revenue: ${nonCaretakerRevenue}`);
    console.log(`Late Fees: ${nonCaretakerLateFees}`);
    console.log(`Grand Total: ${nonCaretakerRevenue + nonCaretakerLateFees}`);
    console.log(`Payments count: ${nonCaretakerPayments.length}`);
    console.log(`Tenants count: ${nonCaretakerTenantIds.size}`);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.disconnect();
  }
}

checkDansu();
