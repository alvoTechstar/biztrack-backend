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

// Create product
router.route('/')
  .post(authenticateToken, createProduct);

// Business products endpoint - MUST come before :id
router.route('/business/:businessId')
  .get(authenticateToken, getProductsByBusiness);

// Stock update endpoint - MUST come before :id
router.route('/:id/stock')
  .put(authenticateToken, updateProductStock);

// Single product operations - MUST come LAST
router.route('/:id')
  .put(authenticateToken, updateProduct)
  .delete(authenticateToken, deleteProduct);

export default router;