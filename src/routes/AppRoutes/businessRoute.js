const express = require('express');
const router = express.Router();


const businessController = require('../../controllers/businessController.js');

router.post('/create', businessController.createBusiness);
router.get('/', businessController.getAllBusinesses);
router.get('/search/:id', businessController.getBusinessById);
router.put('/update/:id', businessController.updateBusiness);
router.put('/update/:id/status', businessController.updateStatus);
router.delete('/delete/:id', businessController.deleteBusiness);


module.exports = router;


//authenticateToken, allowBusinessCreation