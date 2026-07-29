const express = require('express');
const router = express.Router();

const authRoutes = require('./AppRoutes/authRoutes.js');
const businessRoutes = require('./AppRoutes/businessRoute.js');


router.use('/auth', authRoutes);
router.use('/business', businessRoutes);


module.exports = router;