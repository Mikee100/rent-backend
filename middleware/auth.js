import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import User from '../models/User.js';
import { logUnauthorizedAttempt } from './errorLogger.js';

// Load .env file to ensure JWT_SECRET is available
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = join(__dirname, '..', '.env');
dotenv.config({ path: envPath });

export const authenticate = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({ message: 'No token provided. Access denied.' });
    }

    const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
    
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'your-secret-key-change-in-production') {
      console.warn('⚠️  JWT_SECRET not set or using default. Please set JWT_SECRET in .env file.');
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.userId).populate('apartment');

    if (!user || !user.isActive) {
      return res.status(401).json({ message: 'Invalid token or user inactive.' });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Authentication error:', error.message);
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ message: 'Invalid token.' });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Token expired. Please login again.' });
    }
    res.status(401).json({ message: 'Authentication failed.' });
  }
};

export const authorize = (...roles) => {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Authentication required.' });
    }

    if (!roles.includes(req.user.role)) {
      // Log unauthorized access attempt
      const pathParts = req.path.split('/').filter(p => p);
      const entityType = pathParts[0] || 'system'; // Get entity from path (e.g., /api/apartments -> 'apartments')
      await logUnauthorizedAttempt(
        req,
        req.method.toLowerCase(),
        entityType.replace(/s$/, ''), // Remove plural 's' to get entity type
        `User ${req.user.role} attempted to access ${req.method} ${req.path} (requires: ${roles.join(', ')})`
      );
      return res.status(403).json({ message: 'Access denied. Insufficient permissions.' });
    }

    next();
  };
};

// Middleware to filter data based on user role
export const filterByApartment = (req, res, next) => {
  // Superadmin can see all, caretaker only sees their apartment
  if (req.user.role === 'caretaker' && req.user.apartment) {
    const apartmentId = req.user.apartment._id || req.user.apartment;
    req.apartmentFilter = { apartment: apartmentId };
  }
  next();
};

