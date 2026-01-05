import ActivityLog from '../models/ActivityLog.js';

/**
 * Middleware to log user activities
 * @param {Object} options - Configuration options
 * @param {String} options.action - Action type (create, update, delete, etc.)
 * @param {String} options.entityType - Entity type (apartment, tenant, etc.)
 * @param {Function} options.getEntityName - Function to get entity name from request/response
 * @param {Function} options.getChanges - Optional function to get before/after changes
 * @param {Boolean} options.logRequestBody - Whether to log request body (default: true for create/update)
 */
export const logActivity = (options = {}) => {
  return async (req, res, next) => {
    // Store original json method
    const originalJson = res.json.bind(res);
    const originalStatus = res.status.bind(res);

    // Track response status
    let responseStatus = 200;
    res.status = function (code) {
      responseStatus = code;
      return originalStatus(code);
    };

    // Override res.json to capture response
    res.json = function (data) {
      // Log activity after response is sent
      setImmediate(async () => {
        try {
          if (!req.user) return; // Skip if not authenticated

          const {
            action = 'unknown',
            entityType = 'unknown',
            getEntityName = () => null,
            getChanges = () => null,
            description = null,
            logRequestBody = ['create', 'update'].includes(action)
          } = options;

          // Get entity name
          const entityName = getEntityName(req, res, data) || 
                           req.body?.name || 
                           req.body?.firstName || 
                           `${req.body?.firstName || ''} ${req.body?.lastName || ''}`.trim() ||
                           null;

          // Get entity ID
          const entityId = data?._id || 
                          data?.id || 
                          req.params?.id || 
                          req.body?._id || 
                          null;

          // Get changes for update actions
          let changes = null;
          if (action === 'update') {
            changes = await getChanges(req, res, data);
          } else if (logRequestBody && req.body && Object.keys(req.body).length > 0) {
            // Log request body for create operations
            changes = { requestData: req.body };
          }

          // Generate description if not provided
          let logDescription = description;
          if (typeof description === 'function') {
            logDescription = description(req, res, data);
          }
          
          if (!logDescription) {
            const entityDisplay = entityName || entityId || 'item';
            const userRole = req.user.role || 'user';
            const rolePrefix = userRole === 'caretaker' ? '[CARETAKER] ' : '';
            
            switch (action) {
              case 'create':
                logDescription = `${rolePrefix}Created ${entityType}: ${entityDisplay}`;
                break;
              case 'update':
                logDescription = `${rolePrefix}Updated ${entityType}: ${entityDisplay}`;
                break;
              case 'delete':
                logDescription = `${rolePrefix}Deleted ${entityType}: ${entityDisplay}`;
                break;
              case 'view':
                logDescription = `${rolePrefix}Viewed ${entityType}: ${entityDisplay}`;
                break;
              case 'export':
                logDescription = `${rolePrefix}Exported ${entityType} data`;
                break;
              case 'generate':
                logDescription = `${rolePrefix}Generated ${entityType}: ${entityDisplay}`;
                break;
              case 'assign':
                logDescription = `${rolePrefix}Assigned ${entityType}: ${entityDisplay}`;
                break;
              case 'remove':
                logDescription = `${rolePrefix}Removed ${entityType}: ${entityDisplay}`;
                break;
              default:
                logDescription = `${rolePrefix}${action} ${entityType}: ${entityDisplay}`;
            }
          }

          // Get IP address and user agent
          const ipAddress = req.ip || 
                           req.headers['x-forwarded-for']?.split(',')[0] || 
                           req.connection?.remoteAddress || 
                           null;
          const userAgent = req.headers['user-agent'] || null;

          // Enhanced metadata
          const metadata = {
            method: req.method,
            path: req.path,
            statusCode: responseStatus,
            userRole: req.user.role,
            queryParams: req.query,
            timestamp: new Date().toISOString()
          };

          // Add request body summary for create/update (sanitized - no passwords)
          if (logRequestBody && req.body) {
            const sanitizedBody = { ...req.body };
            if (sanitizedBody.password) sanitizedBody.password = '[REDACTED]';
            metadata.requestBody = sanitizedBody;
          }

          // Create activity log
          await ActivityLog.create({
            user: req.user._id,
            action,
            entityType,
            entityId,
            entityName,
            description: logDescription,
            changes,
            ipAddress,
            userAgent,
            metadata
          });
        } catch (error) {
          console.error('Error logging activity:', error);
          // Don't throw error - logging should not break the request
        }
      });

      return originalJson(data);
    };

    next();
  };
};

/**
 * Helper function to log login activity
 */
export const logLogin = async (userId, ipAddress, userAgent, success = true) => {
  try {
    await ActivityLog.create({
      user: userId,
      action: 'login',
      entityType: 'system',
      description: success ? 'User logged in' : 'Failed login attempt',
      ipAddress,
      userAgent,
      metadata: { success }
    });
  } catch (error) {
    console.error('Error logging login:', error);
  }
};

/**
 * Helper function to log logout activity
 */
export const logLogout = async (userId, ipAddress, userAgent) => {
  try {
    await ActivityLog.create({
      user: userId,
      action: 'logout',
      entityType: 'system',
      description: 'User logged out',
      ipAddress,
      userAgent
    });
  } catch (error) {
    console.error('Error logging logout:', error);
  }
};

