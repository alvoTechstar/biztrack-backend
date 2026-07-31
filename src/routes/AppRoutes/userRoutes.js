const express = require('express');
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

const normalizeRole = (role, businessType) => {
    if (!role) return 'Shopkeeper';

    // Convert spaces to underscores
    const normalized = role.replace(/\s+/g, '_');

    // Map generic roles to business-specific roles
    const roleMapping = {
        'Admin': (businessType) => `${businessType}_Admin`,
        'Shopkeeper': (businessType) => `${businessType}_Shopkeeper`,
        'Manager': (businessType) => `${businessType}_Manager`,
        'Receptionist': (businessType) => `${businessType}_Receptionist`,
        'Housekeeping': (businessType) => `${businessType}_Housekeeping`,
        'Waiter': (businessType) => `${businessType}_Waiter`,
        'Chef': (businessType) => `${businessType}_Chef`,
        'Cashier': (businessType) => `${businessType}_Cashier`,
        'Sales_Associate': (businessType) => `${businessType}_Sales_Associate`,
    };

    // If it's a generic role, convert to business-specific role
    if (roleMapping[normalized] && businessType) {
        return roleMapping[normalized](businessType);
    }

    return normalized;
};

const validateRoleForBusinessType = (role, businessType) => {
    const allowedRoles = {
        'Kiosk': ['Kiosk_Admin', 'Kiosk_Shopkeeper', 'Kiosk_Cashier', 'Super_Admin', 'Biztrack_ADMIN'],
        'Hotel': ['Hotel_Admin', 'Hotel_Manager', 'Hotel_Receptionist', 'Hotel_Housekeeping', 'Hotel_Waiter', 'Hotel_Cashier', 'Super_Admin', 'Biztrack_ADMIN'],
        'Restaurant': ['Restaurant_Admin', 'Restaurant_Manager', 'Restaurant_Waiter', 'Restaurant_Chef', 'Restaurant_Cashier', 'Super_Admin', 'Biztrack_ADMIN'],
        'Retail': ['Retail_Admin', 'Retail_Manager', 'Retail_Cashier', 'Retail_Sales_Associate', 'Super_Admin', 'Biztrack_ADMIN'],
    };

    const businessRoles = allowedRoles[businessType] || [];

    return businessRoles.includes(role);
};

const canAccessBusiness = (user, businessId) => {
    console.log('🔍 Checking business access:', {
        userId: user.id,
        userRole: user.role,
        targetBusinessId: businessId
    });

    // SUPER ADMIN and BizTrack Admin can access all businesses
    if (user.role === 'Super_Admin' || user.role === 'Biztrack_ADMIN') {
        console.log('✅ Access granted: Super Admin / BizTrack Admin');
        return true;
    }

    // Get all possible business IDs from the user
    const userBusinessIds = [
        String(user.businessId || '').trim(),
        String(user.associatedBusinessId || '').trim(),
        String(user.institutionId || '').trim(),
        String(user.businessUUID || '').trim()
    ].filter(id => id.length > 0);

    const targetBusinessId = String(businessId || '').trim();

    console.log(`🔍 Business ID comparison:`, {
        userBusinessIds,
        targetBusinessId,
        hasMatch: userBusinessIds.includes(targetBusinessId)
    });

    // Check exact match
    if (userBusinessIds.includes(targetBusinessId)) {
        console.log('✅ Access granted: Exact business ID match');
        return true;
    }

    // Try numeric comparison
    for (const userBusinessId of userBusinessIds) {
        const userNum = parseInt(userBusinessId, 10);
        const targetNum = parseInt(targetBusinessId, 10);

        if (!isNaN(userNum) && !isNaN(targetNum) && userNum === targetNum) {
            console.log('✅ Access granted: Numeric business ID match');
            return true;
        }
    }

    console.log(`❌ Access denied: No business ID match`);
    return false;
};

const generatePasswordResetToken = () => {
    return jwt.sign(
        { type: 'password_reset' },
        process.env.JWT_SECRET,
        { expiresIn: '24h' }
    );
};



router.post('/create-user', protect, restrictToAdmin, userController.createUser);
router.get('/get-all-users', protect, restrictToAdmin, userController.getAllUsers);
router.get('/get-user/:id',protect, userController.getUserById);
router.get('/by-email/:email', protect, userController.getUserByEmail);
router.get('by-username/:username', protect, userController.getUserByUsername);
router.get('/business/:businessId', protect, userController.getUsersByBusiness);
router.get('/by-business/:businessId', protect, userController.byBusiness);
router.patch('/update-user/:id', protect, userController.updateUser);
router.put('/update-user/:id', protect, restrictToAdmin, userController.updateUserById);
router.put('update-status/:id', protect, restrictToAdmin, userController.updateStatus);
router.delete('/delete-user/:id', protect, restrictToAdmin, userController.deleteUser);

module.exports = router;