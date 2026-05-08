// src/routes/kiosk/ProductRoutes.js
import express from 'express';
import {
  createProduct,
  getProductsByBusiness,
  updateProduct,
  deleteProduct,
  updateProductStock
} from '../../controllers/ProductController.js';
import { authenticateToken } from '../../middleware/authMiddleware.js';

const router = express.Router();

// POST   /api/products/add-product
router.post('/add-product', authenticateToken, createProduct);

// GET    /api/products/get-products/:businessId
router.get('/get-products/:businessId', authenticateToken, getProductsByBusiness);

// PUT    /api/products/update-stock/:id
router.put('/update-stock/:id', authenticateToken, updateProductStock);

// PUT    /api/products/update-product/:id
router.put('/update-product/:id', authenticateToken, updateProduct);

// DELETE /api/products/delete-product/:id
router.delete('/delete-product/:id', authenticateToken, deleteProduct);

export default router;
