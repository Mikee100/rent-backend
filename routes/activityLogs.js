import express from 'express';
import ActivityLog from '../models/ActivityLog.js';
import { authenticate, authorize } from '../middleware/auth.js';

const router = express.Router();

// Get all activity logs (superadmin only)
router.get('/', authenticate, authorize('superadmin'), async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      userId,
      action,
      entityType,
      startDate,
      endDate,
      search,
      role
    } = req.query;

    const query = {};

    // Filter by user
    if (userId) {
      query.user = userId;
    }

    // Filter by action
    if (action) {
      query.action = action;
    }

    // Filter by entity type
    if (entityType) {
      query.entityType = entityType;
    }

    // Date range filter
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) {
        query.createdAt.$gte = new Date(startDate);
      }
      if (endDate) {
        query.createdAt.$lte = new Date(endDate);
      }
    }

    // Search filter (description, entityName)
    if (search) {
      query.$or = [
        { description: { $regex: search, $options: 'i' } },
        { entityName: { $regex: search, $options: 'i' } }
      ];
    }

    // Filter by user role
    if (role) {
      const usersWithRole = await User.find({ role }).select('_id');
      const userIds = usersWithRole.map(u => u._id);
      query.user = { $in: userIds };
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [logs, total] = await Promise.all([
      ActivityLog.find(query)
        .populate('user', 'username firstName lastName email role')
        .sort({ createdAt: -1 })
        .limit(parseInt(limit))
        .skip(skip)
        .lean(),
      ActivityLog.countDocuments(query)
    ]);

    res.json({
      logs,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get activity log statistics (superadmin only)
router.get('/statistics', authenticate, authorize('superadmin'), async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    const query = {};
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const [
      totalLogs,
      actionsBreakdown,
      entityTypesBreakdown,
      topUsers,
      recentActivity
    ] = await Promise.all([
      ActivityLog.countDocuments(query),
      ActivityLog.aggregate([
        { $match: query },
        { $group: { _id: '$action', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]),
      ActivityLog.aggregate([
        { $match: query },
        { $group: { _id: '$entityType', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]),
      ActivityLog.aggregate([
        { $match: query },
        { $group: { _id: '$user', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
        {
          $lookup: {
            from: 'users',
            localField: '_id',
            foreignField: '_id',
            as: 'user'
          }
        },
        { $unwind: '$user' },
        {
          $project: {
            user: {
              _id: '$user._id',
              username: '$user.username',
              firstName: '$user.firstName',
              lastName: '$user.lastName',
              role: '$user.role'
            },
            count: 1
          }
        }
      ]),
      ActivityLog.find(query)
        .populate('user', 'username firstName lastName')
        .sort({ createdAt: -1 })
        .limit(10)
        .lean()
    ]);

    res.json({
      totalLogs,
      actionsBreakdown: actionsBreakdown.map(item => ({
        action: item._id,
        count: item.count
      })),
      entityTypesBreakdown: entityTypesBreakdown.map(item => ({
        entityType: item._id,
        count: item.count
      })),
      topUsers,
      recentActivity
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get single activity log (superadmin only)
router.get('/:id', authenticate, authorize('superadmin'), async (req, res) => {
  try {
    const log = await ActivityLog.findById(req.params.id)
      .populate('user', 'username firstName lastName email role');

    if (!log) {
      return res.status(404).json({ message: 'Activity log not found' });
    }

    res.json(log);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Delete activity logs (superadmin only) - for cleanup
router.delete('/cleanup', authenticate, authorize('superadmin'), async (req, res) => {
  try {
    const { days = 90 } = req.query; // Default: delete logs older than 90 days
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - parseInt(days));

    const result = await ActivityLog.deleteMany({
      createdAt: { $lt: cutoffDate }
    });

    res.json({
      message: `Deleted ${result.deletedCount} activity logs older than ${days} days`,
      deletedCount: result.deletedCount
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;

