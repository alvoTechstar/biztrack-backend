const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../../middlewares/authMiddleware.js');

const orderController = require('../../controllers/orderController.js');

router.post('/create-order', authenticateToken, orderController.createOrder);

router.get('/get-orders/:businessId', authenticateToken, orderController.getOrders);

router.get('/get-order/:id', authenticateToken, orderController.getOrder);

router.put('/update-status/:id', authenticateToken, orderController.updateOrderStatus);

router.delete('/:id', authenticateToken, orderController.cancelOrder);

module.exports = router;