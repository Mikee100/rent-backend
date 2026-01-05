import ActivityLog from '../models/ActivityLog.js';

/**
 * Log unauthorized access attempts and errors
 */
export const logUnauthorizedAttempt = async (req, action, entityType, reason) => {
  try {
    if (!req.user) return;

    // Determine entity type from path if not provided
    let finalEntityType = entityType || 'system';
    if (!entityType) {
      const pathParts = req.path.split('/').filter(p => p);
      if (pathParts.length > 1) {
        const possibleEntity = pathParts[1].replace(/s$/, ''); // Remove plural 's'
        const validEntities = ['apartment', 'house', 'tenant', 'payment', 'maintenance', 'expense', 'user', 'config', 'system'];
        if (validEntities.includes(possibleEntity)) {
          finalEntityType = possibleEntity;
        }
      }
    }

    // Map HTTP methods to action types
    let finalAction = action || 'unauthorized_access';
    if (action && typeof action === 'string' && action.length <= 4) {
      // It's likely an HTTP method, map it
      const methodMap = {
        'get': 'view',
        'post': 'create',
        'put': 'update',
        'patch': 'update',
        'delete': 'delete'
      };
      finalAction = methodMap[action.toLowerCase()] || 'unauthorized_access';
    }

    const ipAddress = req.ip || 
                     req.headers['x-forwarded-for']?.split(',')[0] || 
                     req.connection?.remoteAddress || 
                     null;
    const userAgent = req.headers['user-agent'] || null;

    await ActivityLog.create({
      user: req.user._id,
      action: finalAction,
      entityType: finalEntityType,
      description: `[UNAUTHORIZED] Attempted ${req.method} ${req.path}: ${reason}`,
      ipAddress,
      userAgent,
      metadata: {
        method: req.method,
        path: req.path,
        statusCode: 403,
        userRole: req.user.role,
        reason,
        unauthorized: true
      }
    });
  } catch (error) {
    console.error('Error logging unauthorized attempt:', error);
  }
};

/**
 * Log failed operations
 */
export const logFailedOperation = async (req, action, entityType, error, entityId = null) => {
  try {
    if (!req.user) return;

    const ipAddress = req.ip || 
                     req.headers['x-forwarded-for']?.split(',')[0] || 
                     req.connection?.remoteAddress || 
                     null;
    const userAgent = req.headers['user-agent'] || null;

    await ActivityLog.create({
      user: req.user._id,
      action: action || 'failed_operation',
      entityType: entityType || 'system',
      entityId,
      description: `[FAILED] ${action || 'Operation'} on ${entityType || 'resource'} failed: ${error.message || error}`,
      ipAddress,
      userAgent,
      metadata: {
        method: req.method,
        path: req.path,
        statusCode: 400,
        userRole: req.user.role,
        error: error.message || String(error),
        failed: true
      }
    });
  } catch (logError) {
    console.error('Error logging failed operation:', logError);
  }
};

