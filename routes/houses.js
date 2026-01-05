import express from 'express';
import House from '../models/House.js';
import Tenant from '../models/Tenant.js';
import Apartment from '../models/Apartment.js';
import { authenticate, filterByApartment, authorize } from '../middleware/auth.js';
import { logActivity } from '../middleware/activityLogger.js';

const router = express.Router();

// Get all houses (optionally filtered by apartment)
router.get('/', authenticate, filterByApartment, logActivity({
  action: 'view',
  entityType: 'house',
  description: (req) => {
    const role = req.user?.role || 'user';
    const apartmentFilter = req.query.apartment ? ` (apartment: ${req.query.apartment})` : '';
    return `[${role.toUpperCase()}] Viewed houses list${apartmentFilter}`;
  }
}), async (req, res) => {
  try {
    const { apartment } = req.query;
    let query = apartment ? { apartment } : {};
    
    // Apply apartment filter for caretakers
    if (req.apartmentFilter) {
      query = { ...query, ...req.apartmentFilter };
    }
    
    const houses = await House.find(query)
      .populate('apartment', 'name address')
      .populate('tenant', 'firstName lastName email phone')
      .sort({ apartment: 1, houseNumber: 1 });
    res.json(houses);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get single house
router.get('/:id', authenticate, filterByApartment, async (req, res) => {
  try {
    const house = await House.findById(req.params.id)
      .populate('apartment')
      .populate('tenant');
    if (!house) {
      return res.status(404).json({ message: 'House not found' });
    }

    // Check if caretaker can access this house
    if (req.user.role === 'caretaker' && req.user.apartment) {
      const apartmentId = req.user.apartment._id || req.user.apartment;
      const houseApartmentId = house.apartment._id || house.apartment;
      if (apartmentId.toString() !== houseApartmentId.toString()) {
        return res.status(403).json({ message: 'Access denied. You can only view houses in your assigned apartment.' });
      }
    }

    res.json(house);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get houses by apartment
router.get('/apartment/:apartmentId', authenticate, filterByApartment, async (req, res) => {
  try {
    // Check if caretaker can access this apartment
    if (req.user.role === 'caretaker' && req.user.apartment) {
      const apartmentId = req.user.apartment._id || req.user.apartment;
      if (req.params.apartmentId !== apartmentId.toString()) {
        return res.status(403).json({ message: 'Access denied. You can only view houses in your assigned apartment.' });
      }
    }

    const houses = await House.find({ apartment: req.params.apartmentId })
      .populate('tenant', 'firstName lastName email phone')
      .sort({ houseNumber: 1 });
    res.json(houses);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Create house (superadmin only)
router.post('/', authenticate, authorize('superadmin'), async (req, res) => {
  try {
    // Verify apartment exists
    const apartment = await Apartment.findById(req.body.apartment);
    if (!apartment) {
      return res.status(404).json({ message: 'Apartment not found' });
    }

    const house = new House(req.body);
    await house.save();
    
    // Update apartment house count
    await Apartment.findByIdAndUpdate(req.body.apartment, {
      $inc: { totalHouses: 1 }
    });

    const populatedHouse = await House.findById(house._id)
      .populate('apartment', 'name address')
      .populate('tenant');
    res.status(201).json(populatedHouse);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Update house (superadmin or caretaker of the apartment)
router.put('/:id', authenticate, async (req, res) => {
  try {
    const house = await House.findById(req.params.id).populate('apartment');
    if (!house) {
      return res.status(404).json({ message: 'House not found' });
    }

    // Check if caretaker can update this house
    if (req.user.role === 'caretaker' && req.user.apartment) {
      const apartmentId = req.user.apartment._id || req.user.apartment;
      const houseApartmentId = house.apartment._id || house.apartment;
      if (apartmentId.toString() !== houseApartmentId.toString()) {
        return res.status(403).json({ message: 'Access denied. You can only update houses in your assigned apartment.' });
      }
    }

    const updatedHouse = await House.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    )
      .populate('apartment', 'name address')
      .populate('tenant', 'firstName lastName email phone');
    res.json(updatedHouse);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Delete house (superadmin only)
router.delete('/:id', authenticate, authorize('superadmin'), async (req, res) => {
  try {
    const house = await House.findById(req.params.id);
    if (!house) {
      return res.status(404).json({ message: 'House not found' });
    }

    // Remove tenant assignment if exists
    if (house.tenant) {
      const tenant = await Tenant.findById(house.tenant);
      if (tenant) {
        tenant.house = null;
        await tenant.save();
      }
    }

    const apartmentId = house.apartment;
    await House.findByIdAndDelete(req.params.id);

    // Update apartment house count
    await Apartment.findByIdAndUpdate(apartmentId, {
      $inc: { totalHouses: -1 }
    });

    res.json({ message: 'House deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Assign tenant to house
router.post('/:id/assign-tenant', authenticate, async (req, res) => {
  try {
    const { tenantId } = req.body;
    const house = await House.findById(req.params.id).populate('apartment');
    const tenant = await Tenant.findById(tenantId);

    // Check if caretaker can assign tenant to this house
    if (req.user.role === 'caretaker' && req.user.apartment) {
      const apartmentId = req.user.apartment._id || req.user.apartment;
      const houseApartmentId = house.apartment._id || house.apartment;
      if (apartmentId.toString() !== houseApartmentId.toString()) {
        return res.status(403).json({ message: 'Access denied. You can only assign tenants to houses in your assigned apartment.' });
      }
    }

    if (!house) {
      return res.status(404).json({ message: 'House not found' });
    }
    if (!tenant) {
      return res.status(404).json({ message: 'Tenant not found' });
    }

    // Track house move if tenant is moving from another house
    if (tenant.house && tenant.house.toString() !== house._id.toString()) {
      const previousHouse = await House.findById(tenant.house).populate('apartment');
      if (previousHouse) {
        // Add to house move history
        if (!tenant.houseMoveHistory) {
          tenant.houseMoveHistory = [];
        }
        tenant.houseMoveHistory.push({
          fromHouse: previousHouse._id,
          toHouse: house._id,
          fromApartment: previousHouse.apartment?._id || null,
          toApartment: house.apartment || null,
          moveDate: new Date(),
          reason: req.body.reason || 'House reassignment',
          notes: req.body.notes || ''
        });

        // Clear previous house
        previousHouse.tenant = null;
        previousHouse.status = 'available';
        await previousHouse.save();
      }
    }

    house.tenant = tenantId;
    house.status = 'occupied';
    tenant.house = house._id;
    
    await house.save();
    await tenant.save();

    const updatedHouse = await House.findById(req.params.id)
      .populate('apartment', 'name address')
      .populate('tenant', 'firstName lastName email phone');
    res.json(updatedHouse);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Get occupancy analytics
router.get('/analytics/occupancy', async (req, res) => {
  try {
    const houses = await House.find();
    const occupied = houses.filter(h => h.status === 'occupied').length;
    const available = houses.filter(h => h.status === 'available').length;
    const maintenance = houses.filter(h => h.status === 'maintenance').length;
    
    res.json({
      occupied,
      available,
      maintenance,
      total: houses.length
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Remove tenant from house
router.post('/:id/remove-tenant', authenticate, async (req, res) => {
  try {
    const house = await House.findById(req.params.id).populate('apartment');
    
    // Check if caretaker can remove tenant from this house
    if (req.user.role === 'caretaker' && req.user.apartment) {
      const apartmentId = req.user.apartment._id || req.user.apartment;
      const houseApartmentId = house.apartment._id || house.apartment;
      if (apartmentId.toString() !== houseApartmentId.toString()) {
        return res.status(403).json({ message: 'Access denied. You can only remove tenants from houses in your assigned apartment.' });
      }
    }
    if (!house) {
      return res.status(404).json({ message: 'House not found' });
    }

    if (house.tenant) {
      const tenant = await Tenant.findById(house.tenant);
      if (tenant) {
        tenant.house = null;
        await tenant.save();
      }
    }

    house.tenant = null;
    house.status = 'available';
    await house.save();

    const updatedHouse = await House.findById(req.params.id)
      .populate('apartment', 'name address')
      .populate('tenant', 'firstName lastName email phone');
    res.json(updatedHouse);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

export default router;



