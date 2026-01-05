import mongoose from 'mongoose';

const activityLogSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  action: {
    type: String,
    required: true,
    enum: [
      'login',
      'logout',
      'create',
      'update',
      'delete',
      'view',
      'export',
      'generate',
      'assign',
      'remove',
      'register',
      'password_reset',
      'status_change',
      'unauthorized_access',
      'failed_operation'
    ]
  },
  entityType: {
    type: String,
    required: true,
    enum: [
      'apartment',
      'house',
      'tenant',
      'payment',
      'maintenance',
      'expense',
      'user',
      'config',
      'system',
      'unknown'
    ]
  },
  entityId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null
  },
  entityName: {
    type: String,
    default: null // Human-readable name (e.g., tenant name, apartment name)
  },
  description: {
    type: String,
    required: true
  },
  changes: {
    type: mongoose.Schema.Types.Mixed,
    default: null // Store before/after values for updates
  },
  ipAddress: {
    type: String,
    default: null
  },
  userAgent: {
    type: String,
    default: null
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true
});

// Index for faster queries
activityLogSchema.index({ user: 1, createdAt: -1 });
activityLogSchema.index({ action: 1, createdAt: -1 });
activityLogSchema.index({ entityType: 1, createdAt: -1 });
activityLogSchema.index({ createdAt: -1 });

export default mongoose.model('ActivityLog', activityLogSchema);

