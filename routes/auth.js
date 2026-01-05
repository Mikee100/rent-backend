import express from 'express';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import User from '../models/User.js';
import Apartment from '../models/Apartment.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { logLogin, logLogout, logActivity } from '../middleware/activityLogger.js';

// Load .env file
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = join(__dirname, '..', '.env');
dotenv.config({ path: envPath });

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// Warn if JWT_SECRET is not set
if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'your-secret-key-change-in-production') {
  console.warn('⚠️  WARNING: JWT_SECRET not set in .env file. Using default secret. This is insecure for production!');
  console.warn('   Please add JWT_SECRET=your-secret-key to your backend/.env file');
}

// Register new user (superadmin only)
router.post('/register', authenticate, authorize('superadmin'), logActivity({
  action: 'register',
  entityType: 'user',
  getEntityName: (req) => `${req.body?.firstName || ''} ${req.body?.lastName || ''}`.trim() || req.body?.username
}), async (req, res) => {
  try {
    const { username, email, password, role, apartmentId, firstName, lastName, phone } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({
      $or: [{ email }, { username }]
    });

    if (existingUser) {
      return res.status(400).json({ message: 'User with this email or username already exists.' });
    }

    // Validate apartment if caretaker
    if (role === 'caretaker' && apartmentId) {
      const apartment = await Apartment.findById(apartmentId);
      if (!apartment) {
        return res.status(404).json({ message: 'Apartment not found.' });
      }
    }

    // Create user
    const user = new User({
      username,
      email,
      password,
      role: role || 'caretaker',
      apartment: role === 'caretaker' ? apartmentId : null,
      firstName,
      lastName,
      phone
    });

    await user.save();

    // If caretaker, update apartment
    if (role === 'caretaker' && apartmentId) {
      await Apartment.findByIdAndUpdate(apartmentId, { caretaker: user._id });
    }

    // Generate token
    const token = jwt.sign(
      { userId: user._id, role: user.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    const populatedUser = await User.findById(user._id).populate('apartment');

    res.status(201).json({
      message: 'User registered successfully',
      token,
      user: populatedUser
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required.' });
    }

    // Find user
    const user = await User.findOne({ email: email.toLowerCase() }).populate('apartment');

    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    if (!user.isActive) {
      return res.status(401).json({ message: 'Account is inactive. Please contact administrator.' });
    }

    // Check password
    const isPasswordValid = await user.comparePassword(password);

    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    // Generate token
    const token = jwt.sign(
      { userId: user._id, role: user.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    // Log login activity
    const ipAddress = req.ip || req.headers['x-forwarded-for']?.split(',')[0] || req.connection?.remoteAddress;
    const userAgent = req.headers['user-agent'];
    await logLogin(user._id, ipAddress, userAgent, true);

    res.json({
      message: 'Login successful',
      token,
      user
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Logout
router.post('/logout', authenticate, async (req, res) => {
  try {
    const ipAddress = req.ip || req.headers['x-forwarded-for']?.split(',')[0] || req.connection?.remoteAddress;
    const userAgent = req.headers['user-agent'];
    await logLogout(req.user._id, ipAddress, userAgent);
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get current user
router.get('/me', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).populate('apartment');
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Update user profile
router.put('/profile', authenticate, async (req, res) => {
  try {
    const { firstName, lastName, phone, password } = req.body;
    const updateData = { firstName, lastName, phone };

    // Update password if provided
    if (password) {
      updateData.password = password;
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      updateData,
      { new: true, runValidators: true }
    ).populate('apartment');

    res.json({
      message: 'Profile updated successfully',
      user
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Get all users (superadmin only)
router.get('/users', authenticate, authorize('superadmin'), async (req, res) => {
  try {
    const users = await User.find({})
      .select('-password')
      .populate('apartment', 'name address')
      .sort({ createdAt: -1 });
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Update user (superadmin only)
router.put('/users/:id', authenticate, authorize('superadmin'), async (req, res) => {
  try {
    const { firstName, lastName, email, phone, role, apartmentId, isActive, password } = req.body;
    const updateData = { firstName, lastName, email, phone, role, isActive };

    // Update apartment assignment if provided
    if (apartmentId !== undefined) {
      if (role === 'caretaker' && apartmentId) {
        const apartment = await Apartment.findById(apartmentId);
        if (!apartment) {
          return res.status(404).json({ message: 'Apartment not found.' });
        }
        updateData.apartment = apartmentId;
        // Update apartment's caretaker field
        await Apartment.findByIdAndUpdate(apartmentId, { caretaker: req.params.id });
      } else {
        updateData.apartment = null;
        // Remove caretaker from apartment if role changed
        const user = await User.findById(req.params.id);
        if (user && user.apartment) {
          await Apartment.findByIdAndUpdate(user.apartment, { $unset: { caretaker: 1 } });
        }
      }
    }

    // Update password if provided
    if (password) {
      updateData.password = password;
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    )
      .select('-password')
      .populate('apartment', 'name address');

    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    res.json({
      message: 'User updated successfully',
      user
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Delete user (superadmin only)
router.delete('/users/:id', authenticate, authorize('superadmin'), logActivity({
  action: 'delete',
  entityType: 'user',
  getEntityName: async (req) => {
    const user = await User.findById(req.params.id);
    return user ? `${user.firstName} ${user.lastName}`.trim() || user.username : null;
  }
}), async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    // Don't allow deleting yourself
    if (user._id.toString() === req.user._id.toString()) {
      return res.status(400).json({ message: 'You cannot delete your own account.' });
    }

    // Remove caretaker assignment from apartment if exists
    if (user.apartment) {
      await Apartment.findByIdAndUpdate(user.apartment, { $unset: { caretaker: 1 } });
    }

    await User.findByIdAndDelete(req.params.id);

    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;

