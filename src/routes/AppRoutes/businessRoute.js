const express = require('express');
const router = express.Router();


const businessController = require('../../controllers/businessController.js');
const { createAuthMiddleware } = require('../../middlewares/authMiddleware.js')
const { storage } = require('../../utils/storage.js');


// Create auth middleware with storage dependency
const authMiddleware = createAuthMiddleware(storage);
const {
    authenticateToken,
    requireActiveBusiness,
    allowBusinessCreation,
    requireBusinessOwner,
    authorize
} = authMiddleware;


router.post('/create', authenticateToken, allowBusinessCreation, businessController.createBusiness);
router.get('/', businessController.getAllBusinesses);
router.get('/search/:id', businessController.getBusinessById);
router.put('/update/:id', businessController.updateBusinessById);
router.put('/update/:id/status', businessController.updateStatus);
// router.delete('/delete/:id', businessController.deleteBusiness);


module.exports = router;


//authenticateToken, allowBusinessCreation