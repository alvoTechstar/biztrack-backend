const express = require('express');
const router = express.Router();

const authRoutes = require('./AppRoutes/authRoutes.js');
const businessRoutes = require('./AppRoutes/businessRoute.js');
const userRoutes = require('./AppRoutes/userRoutes.js');

router.use('/auth', authRoutes);
router.use('/business', businessRoutes);
router.use('/users', userRoutes);


module.exports = router;