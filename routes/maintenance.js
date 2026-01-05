import express from 'express';
import MaintenanceRequest from '../models/MaintenanceRequest.js';
import House from '../models/House.js';
import Apartment from '../models/Apartment.js';
import { authenticate, filterByApartment, authorize } from '../middleware/auth.js';
import { logActivity } from '../middleware/activityLogger.js';

const router = express.Router();

// Get all maintenance requests
router.get('/', authenticate, filterByApartment, logActivity({
  action: 'view',
  entityType: 'maintenance',
  description: (req) => {
    const role = req.user?.role || 'user';
    return `[${role.toUpperCase()}] Viewed maintenance requests list`;
  }
}), async (req, res) => {
  try {
    const { status, priority, apartment, house } = req.query;
    const query = {};
    
    // Apply apartment filter for caretakers
    if (req.apartmentFilter) {
      query.apartment = req.apartmentFilter.apartment;
    } else if (apartment) {
      query.apartment = apartment;
    }
    
    if (status) query.status = status;
    if (priority) query.priority = priority;
    if (house) query.house = house;

    const requests = await MaintenanceRequest.find(query)
      .populate('house', 'houseNumber floor')
      .populate('apartment', 'name address')
      .populate('tenant', 'firstName lastName email phone')
      .sort({ requestedDate: -1 });
    res.json(requests);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get single maintenance request
router.get('/:id', authenticate, filterByApartment, async (req, res) => {
  try {
    const request = await MaintenanceRequest.findById(req.params.id)
      .populate('house')
      .populate('apartment')
      .populate('tenant');
    if (!request) {
      return res.status(404).json({ message: 'Maintenance request not found' });
    }

    // Check if caretaker can access this request
    if (req.user.role === 'caretaker' && req.user.apartment && request.apartment) {
      const apartmentId = req.user.apartment._id || req.user.apartment;
      const requestApartmentId = request.apartment._id || request.apartment;
      if (apartmentId.toString() !== requestApartmentId.toString()) {
        return res.status(403).json({ message: 'Access denied.' });
      }
    }

    res.json(request);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Create maintenance request
router.post('/', async (req, res) => {
  try {
    const house = await House.findById(req.body.house);
    if (!house) {
      return res.status(404).json({ message: 'House not found' });
    }

    const requestData = {
      ...req.body,
      apartment: house.apartment
    };

    const request = new MaintenanceRequest(requestData);
    await request.save();

    const populatedRequest = await MaintenanceRequest.findById(request._id)
      .populate('house', 'houseNumber floor')
      .populate('apartment', 'name address')
      .populate('tenant', 'firstName lastName email phone');
    
    res.status(201).json(populatedRequest);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Update maintenance request
router.put('/:id', async (req, res) => {
  try {
    const request = await MaintenanceRequest.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    )
      .populate('house', 'houseNumber floor')
      .populate('apartment', 'name address')
      .populate('tenant', 'firstName lastName email phone');
    
    if (!request) {
      return res.status(404).json({ message: 'Maintenance request not found' });
    }

    // If status is completed, set completedDate
    if (req.body.status === 'completed' && !request.completedDate) {
      request.completedDate = new Date();
      await request.save();
    }

    res.json(request);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Delete maintenance request
router.delete('/:id', async (req, res) => {
  try {
    const request = await MaintenanceRequest.findByIdAndDelete(req.params.id);
    if (!request) {
      return res.status(404).json({ message: 'Maintenance request not found' });
    }
    res.json({ message: 'Maintenance request deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;

