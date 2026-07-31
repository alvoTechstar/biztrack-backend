const express = require('express');
const router = express.Router();
const multer = require('multer')

const businessController = require('../../controllers/businessController.js');
const { createAuthMiddleware } = require('../../middlewares/authMiddleware.js')
const { storage } = require('../../utils/storage.js');

const storageConfig = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, logosDir);
    },
    filename: (req, file, cb) => {
        // Generate unique filename: timestamp + random string + original extension
        const timestamp = Date.now();
        const randomStr = Math.random().toString(36).substring(2, 8);
        const ext = path.extname(file.originalname).toLowerCase();
        const filename = `logo_${timestamp}_${randomStr}${ext}`;
        cb(null, filename);
    }
});

const upload = multer({
    storage: storageConfig,
    limits: {
        fileSize: 2 * 1024 * 1024, // 2MB limit
    },
    fileFilter: (req, file, cb) => {
        // Check if file is an image
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed!'), false);
        }
    }
});

// Create auth middleware with storage dependency
const authMiddleware = createAuthMiddleware(storage);
const {
    authenticateToken,
    requireActiveBusiness,
    allowBusinessCreation,
    requireBusinessOwner,
    authorize
} = authMiddleware;

const adminRoles = ['super-admin', 'super_admin', 'Super_Admin', 'Biztrack_ADMIN', 'admin'];

router.post('/create', authenticateToken, allowBusinessCreation, upload.single('logo'), businessController.createBusiness);
router.get('/get-all-businesses', authenticateToken, requireActiveBusiness, authorize(adminRoles),businessController.getAllBusinesses);
router.get('/get-business/:id', authenticateToken, requireBusinessOwner, businessController.getBusinessById);
router.get('business-status/:id', businessController.businessStatus);
router.get('debug/storage', authenticateToken, requireActiveBusiness, businessController.debugStorage);
router.put('/update-business/:id', authenticateToken, requireBusinessOwner, upload.single('logo'), businessController.updateBusinessById);
router.put('/update-status/:id/', authenticateToken, requireBusinessOwner, authorize(adminRoles), businessController.updateStatus);
router.delete('/delete-business/:id', authenticateToken, requireActiveBusiness, authorize(adminRoles), businessController.deleteBusiness);


module.exports = router;

