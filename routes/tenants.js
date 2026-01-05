import express from 'express';
import Tenant from '../models/Tenant.js';
import House from '../models/House.js';
import { authenticate, filterByApartment, authorize } from '../middleware/auth.js';
import { logActivity } from '../middleware/activityLogger.js';

const router = express.Router();

// Get all tenants
router.get('/', authenticate, filterByApartment, logActivity({
  action: 'view',
  entityType: 'tenant',
  description: (req) => {
    const role = req.user?.role || 'user';
    return `[${role.toUpperCase()}] Viewed tenants list`;
  }
}), async (req, res) => {
  try {
    let query = {};
    
    // Filter tenants by apartment for caretakers
    if (req.apartmentFilter) {
      const houses = await House.find(req.apartmentFilter).select('_id');
      const houseIds = houses.map(h => h._id);
      query = { house: { $in: houseIds } };
    }
    
    const tenants = await Tenant.find(query)
      .populate({
        path: 'house',
        populate: {
          path: 'apartment',
          select: 'name address'
        }
      })
      .sort({ lastName: 1, firstName: 1 });
    res.json(tenants);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get single tenant
router.get('/:id', authenticate, filterByApartment, async (req, res) => {
  try {
    const tenant = await Tenant.findById(req.params.id)
      .populate({
        path: 'house',
        populate: {
          path: 'apartment',
          select: 'name address'
        }
      });
    if (!tenant) {
      return res.status(404).json({ message: 'Tenant not found' });
    }

    // Check if caretaker can access this tenant
    if (req.user.role === 'caretaker' && req.user.apartment && tenant.house) {
      const apartmentId = req.user.apartment._id || req.user.apartment;
      const tenantApartmentId = tenant.house.apartment._id || tenant.house.apartment;
      if (apartmentId.toString() !== tenantApartmentId.toString()) {
        return res.status(403).json({ message: 'Access denied. You can only view tenants in your assigned apartment.' });
      }
    }

    res.json(tenant);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Create tenant
router.post('/', authenticate, authorize('superadmin'), logActivity({
  action: 'create',
  entityType: 'tenant',
  getEntityName: (req) => `${req.body?.firstName || ''} ${req.body?.lastName || ''}`.trim() || req.body?.name
}), async (req, res) => {
  try {
    const tenant = new Tenant(req.body);
    await tenant.save();
    const populatedTenant = await Tenant.findById(tenant._id)
      .populate({
        path: 'house',
        populate: {
          path: 'apartment',
          select: 'name address'
        }
      });
    res.status(201).json(populatedTenant);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Update tenant
router.put('/:id', authenticate, authorize('superadmin'), logActivity({
  action: 'update',
  entityType: 'tenant',
  getEntityName: async (req) => {
    const tenant = await Tenant.findById(req.params.id);
    return tenant ? `${tenant.firstName} ${tenant.lastName}`.trim() : null;
  },
  getChanges: async (req) => {
    const old = await Tenant.findById(req.params.id).lean();
    return { before: old, after: req.body };
  }
}), async (req, res) => {
  try {
    const tenant = await Tenant.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    )
      .populate({
        path: 'house',
        populate: {
          path: 'apartment',
          select: 'name address'
        }
      });
    if (!tenant) {
      return res.status(404).json({ message: 'Tenant not found' });
    }
    res.json(tenant);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Delete tenant
router.delete('/:id', authenticate, authorize('superadmin'), logActivity({
  action: 'delete',
  entityType: 'tenant',
  getEntityName: async (req) => {
    const tenant = await Tenant.findById(req.params.id);
    return tenant ? `${tenant.firstName} ${tenant.lastName}`.trim() : null;
  }
}), async (req, res) => {
  try {
    const tenant = await Tenant.findById(req.params.id);
    if (!tenant) {
      return res.status(404).json({ message: 'Tenant not found' });
    }

    // Remove tenant from house if assigned
    if (tenant.house) {
      const house = await House.findById(tenant.house);
      if (house) {
        house.tenant = null;
        house.status = 'available';
        await house.save();
      }
    }

    await Tenant.findByIdAndDelete(req.params.id);
    res.json({ message: 'Tenant deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Add document to tenant
router.post('/:id/documents', async (req, res) => {
  try {
    const tenant = await Tenant.findById(req.params.id);
    if (!tenant) {
      return res.status(404).json({ message: 'Tenant not found' });
    }

    const document = {
      type: req.body.type,
      name: req.body.name,
      url: req.body.url,
      uploadedDate: new Date()
    };

    tenant.documents.push(document);
    await tenant.save();

    const populatedTenant = await Tenant.findById(tenant._id)
      .populate({
        path: 'house',
        populate: {
          path: 'apartment',
          select: 'name address'
        }
      });

    res.json(populatedTenant);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Delete document from tenant
router.delete('/:id/documents/:docId', async (req, res) => {
  try {
    const tenant = await Tenant.findById(req.params.id);
    if (!tenant) {
      return res.status(404).json({ message: 'Tenant not found' });
    }

    tenant.documents = tenant.documents.filter(
      doc => doc._id.toString() !== req.params.docId
    );
    await tenant.save();

    res.json(tenant);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Add communication log entry
router.post('/:id/communication', async (req, res) => {
  try {
    const tenant = await Tenant.findById(req.params.id);
    if (!tenant) {
      return res.status(404).json({ message: 'Tenant not found' });
    }

    const logEntry = {
      date: req.body.date || new Date(),
      type: req.body.type,
      subject: req.body.subject,
      notes: req.body.notes,
      createdBy: req.body.createdBy || 'System'
    };

    tenant.communicationLog.push(logEntry);
    await tenant.save();

    const populatedTenant = await Tenant.findById(tenant._id)
      .populate({
        path: 'house',
        populate: {
          path: 'apartment',
          select: 'name address'
        }
      });

    res.json(populatedTenant);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

export default router;
