// backend/routes/TransactionRoutes.js
import express from 'express';
import {
    createTransaction,
    getTransactionsByBusiness,
    getDailyReportByBusiness,
    getAllTransactions,
    updateTransaction,
    getTransactionByTransactionId
} from '../../controllers/TransactionController.js';
import { authenticateToken } from '../../middleware/authMiddleware.js';

const router = express.Router();

// Create a new transaction
// POST /api/transactions
router.post('/', authenticateToken, createTransaction);

// Get all transactions (for debugging)
// GET /api/transactions
router.get('/', authenticateToken, getAllTransactions);

// Get transactions by business ID
// GET /api/transactions/business/:businessId
router.get('/business/:businessId', authenticateToken, getTransactionsByBusiness);

// Get daily report by business
// GET /api/transactions/business/:businessId/report/:date
router.get('/business/:businessId/report/:date', authenticateToken, getDailyReportByBusiness);

// Get transaction by transactionId (for polling) - MUST be before /:id route
// GET /api/transactions/by-id/:transactionId
router.get('/by-id/:transactionId', authenticateToken, getTransactionByTransactionId);

// Update transaction (for debt payment and M-PESA updates)
// PUT /api/transactions/:id
router.put('/:id', authenticateToken, updateTransaction);

export default router;