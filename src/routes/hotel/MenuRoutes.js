// src/routes/hotel/MenuRoutes.js
import express from 'express';
import {
  createMenuItem,
  getMenuItemsByBusiness,
  updateMenuItem,
  deleteMenuItem,
} from '../../controllers/MenuController.js';
import { authenticateToken } from '../../middleware/authMiddleware.js';

const router = express.Router();

// POST   /api/menu/add-item
router.post('/add-item', authenticateToken, createMenuItem);

// GET    /api/menu/get-items/:businessId
router.get('/get-items/:businessId', authenticateToken, getMenuItemsByBusiness);

// PUT    /api/menu/update-item/:id
router.put('/update-item/:id', authenticateToken, updateMenuItem);

// DELETE /api/menu/delete-item/:id
router.delete('/delete-item/:id', authenticateToken, deleteMenuItem);

export default router;
