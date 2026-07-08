// src/routes/OrderRoutes.js
import express from 'express';
import {
  createOrder,
  getOrders,
  getOrder,
  updateOrderStatus,
  cancelOrder,
} from '../controllers/OrderController.js';
import { authenticateToken } from '../middleware/authMiddleware.js';

const router = express.Router();

// POST   /api/orders/create-order
router.post('/create-order', authenticateToken, createOrder);

// GET    /api/orders/get-orders/:businessId  (?status=pending,ready&waiter=John&from=2026-05-01&to=2026-05-31)
router.get('/get-orders/:businessId', authenticateToken, getOrders);

// GET    /api/orders/get-order/:id
router.get('/get-order/:id', authenticateToken, getOrder);

// PUT    /api/orders/update-status/:id
router.put('/update-status/:id', authenticateToken, updateOrderStatus);

// DELETE /api/orders/:id  — soft delete (sets status to cancelled)
router.delete('/:id', authenticateToken, cancelOrder);

export default router;
