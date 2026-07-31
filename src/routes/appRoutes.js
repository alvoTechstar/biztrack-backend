const express = require('express');
const router = express.Router();

const authRoutes = require('./AppRoutes/authRoutes.js');
const businessRoutes = require('./AppRoutes/businessRoute.js');
const userRoutes = require('./AppRoutes/userRoutes.js');
const productRoutes = require('./AppRoutes/productRoutes.js');
const transactionRoutes = require('./AppRoutes//transactionRoutes.js');
const menuRoutes = require('./AppRoutes/menuRoutes.js');
const mpesaRoutes = require('./AppRoutes/mpesaRoutes.js');
const orderRoutes = require('./AppRoutes/orderRoutes.js');

router.use('/auth', authRoutes);
router.use('/business', businessRoutes);
router.use('/users', userRoutes);
router.use("/products", productRoutes);
router.use('/transactions', transactionRoutes);
router.use('/api/mpesa', mpesaRoutes);
router.use("/api/menu", menuRoutes);
router.use("/api/orders", orderRoutes);


module.exports = router;