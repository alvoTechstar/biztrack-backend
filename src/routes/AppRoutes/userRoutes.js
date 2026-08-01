const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();

const userController = require('../../controllers/userController.js')

const protect = (req, res, next) => {
    try {
        const token = req.header('Authorization')?.replace('Bearer ', '');

        if (!token) {
            return res.status(401).json({
                success: false,
                message: 'Access denied. No token provided.'
            });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        console.error('JWT verification failed:', error.message);
        return res.status(401).json({
            success: false,
            message: 'Invalid or expired token'
        });
    }
};

const restrictToAdmin = (req, res, next) => {
    const userRole = req.user.role;

    // Allow Super Admin, BizTrack Admin, and business-specific admins
    const isAdmin = userRole === 'Super_Admin' ||
        userRole === 'Biztrack_ADMIN' ||
        userRole.endsWith('_Admin');

    if (isAdmin) {
        next();
    } else {
        res.status(403).json({
            success: false,
            message: 'Forbidden: Insufficient privileges. Admin access required.'
        });
    }
};

router.post('/create-user', protect, restrictToAdmin, userController.createUser);
router.get('/get-all-users', protect, restrictToAdmin, userController.getAllUsers);
router.get('/get-user/:id',protect, userController.getUserById);
router.get('/by-email/:email', protect, userController.getUserByEmail);
router.get('/by-username/:username', protect, userController.getUserByUsername);
router.get('/business/:businessId', protect, userController.getUsersByBusiness);
router.get('/by-business/:businessId', protect, userController.byBusiness);
router.patch('/update-user/:id', protect, userController.updateUser);
router.put('/update-user/:id', protect, restrictToAdmin, userController.updateUserById);
router.put('/update-status/:id', protect, restrictToAdmin, userController.updateStatus);
router.delete('/delete-user/:id', protect, restrictToAdmin, userController.deleteUser);

module.exports = router;