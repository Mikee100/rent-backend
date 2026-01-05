import express from 'express';
import Apartment from '../models/Apartment.js';
import House from '../models/House.js';
import { authenticate, filterByApartment, authorize } from '../middleware/auth.js';
import { logActivity } from '../middleware/activityLogger.js';

const router = express.Router();

// Get all apartments (buildings)
router.get('/', authenticate, filterByApartment, logActivity({
  action: 'view',
  entityType: 'apartment',
  description: (req) => {
    const role = req.user?.role || 'user';
    return `[${role.toUpperCase()}] Viewed apartments list`;
  }
}), async (req, res) => {
  try {
    // Superadmin sees all, caretaker sees only their apartment
    const query = req.apartmentFilter || {};
    const apartments = await Apartment.find(query).populate('caretaker', 'username email firstName lastName').sort({ name: 1 });
    // Get house counts for each apartment
    const apartmentsWithCounts = await Promise.all(
      apartments.map(async (apt) => {
        const houseCounts = await House.aggregate([
          { $match: { apartment: apt._id } },
          { $group: { _id: '$status', count: { $sum: 1 } } }
        ]);
        const total = await House.countDocuments({ apartment: apt._id });
        const occupied = houseCounts.find(h => h._id === 'occupied')?.count || 0;
        const available = houseCounts.find(h => h._id === 'available')?.count || 0;
        return {
          ...apt.toObject(),
          totalHouses: total,
          occupiedHouses: occupied,
          availableHouses: available
        };
      })
    );
    res.json(apartmentsWithCounts);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get single apartment with houses
router.get('/:id', authenticate, filterByApartment, async (req, res) => {
  try {
    // Check if caretaker can access this apartment
    if (req.user.role === 'caretaker' && req.user.apartment) {
      const apartmentId = req.user.apartment._id || req.user.apartment;
      if (req.params.id !== apartmentId.toString()) {
        return res.status(403).json({ message: 'Access denied. You can only view your assigned apartment.' });
      }
    }

    const apartment = await Apartment.findById(req.params.id).populate('caretaker', 'username email firstName lastName');
    if (!apartment) {
      return res.status(404).json({ message: 'Apartment not found' });
    }
    const houses = await House.find({ apartment: req.params.id })
      .populate('tenant', 'firstName lastName email phone')
      .sort({ floor: 1, houseNumber: 1 });
    res.json({ apartment, houses });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Create apartment (superadmin only)
router.post('/', authenticate, authorize('superadmin'), logActivity({
  action: 'create',
  entityType: 'apartment',
  getEntityName: (req) => req.body?.name
}), async (req, res) => {
  try {
    const apartment = new Apartment(req.body);
    await apartment.save();
    res.status(201).json(apartment);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Update apartment (superadmin or caretaker of that apartment)
router.put('/:id', authenticate, logActivity({
  action: 'update',
  entityType: 'apartment',
  getEntityName: async (req) => {
    const apt = await Apartment.findById(req.params.id);
    return apt?.name;
  },
  getChanges: async (req) => {
    const old = await Apartment.findById(req.params.id).lean();
    return { before: old, after: req.body };
  }
}), async (req, res) => {
  try {
    // Check if caretaker can update this apartment
    if (req.user.role === 'caretaker' && req.user.apartment) {
      const apartmentId = req.user.apartment._id || req.user.apartment;
      if (req.params.id !== apartmentId.toString()) {
        return res.status(403).json({ message: 'Access denied. You can only update your assigned apartment.' });
      }
      // Caretakers can only update certain fields
      const allowedFields = ['name', 'address', 'description', 'manager'];
      Object.keys(req.body).forEach(key => {
        if (!allowedFields.includes(key)) {
          delete req.body[key];
        }
      });
    }

    const apartment = await Apartment.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    ).populate('caretaker', 'username email firstName lastName');
    if (!apartment) {
      return res.status(404).json({ message: 'Apartment not found' });
    }
    res.json(apartment);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Delete apartment (superadmin only)
router.delete('/:id', authenticate, authorize('superadmin'), logActivity({
  action: 'delete',
  entityType: 'apartment',
  getEntityName: async (req) => {
    const apt = await Apartment.findById(req.params.id);
    return apt?.name;
  }
}), async (req, res) => {
  try {
    // Check if apartment has houses
    const houseCount = await House.countDocuments({ apartment: req.params.id });
    if (houseCount > 0) {
      return res.status(400).json({ 
        message: 'Cannot delete apartment with existing houses. Delete houses first.' 
      });
    }
    
    const apartment = await Apartment.findByIdAndDelete(req.params.id);
    if (!apartment) {
      return res.status(404).json({ message: 'Apartment not found' });
    }
    res.json({ message: 'Apartment deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;
