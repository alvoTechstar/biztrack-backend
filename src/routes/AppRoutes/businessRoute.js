const express = require('express');
const router = express.Router();


const businessController = require('../../controllers/businessController.js');

router.post('/create', businessController.createBusiness);


module.exports = router;


//authenticateToken, allowBusinessCreation