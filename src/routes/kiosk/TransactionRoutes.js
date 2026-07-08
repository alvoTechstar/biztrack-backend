// src/routes/kiosk/TransactionRoutes.js
import express from 'express';
import {
    createTransaction,
    getTransactionsByBusiness,
    getDailyReportByBusiness,
    getAllTransactions,
    updateTransaction,
    getTransactionByTransactionId,
    getDebtsByBusiness,
    repayDebt
} from '../../controllers/TransactionController.js';
import { authenticateToken } from '../../middleware/authMiddleware.js';

const router = express.Router();

// POST   /api/transactions/create-transaction
router.post('/create-transaction', authenticateToken, createTransaction);

// GET    /api/transactions/get-all-transactions
router.get('/get-all-transactions', authenticateToken, getAllTransactions);

// GET    /api/transactions/get-transactions/:businessId
router.get('/get-transactions/:businessId', authenticateToken, getTransactionsByBusiness);

// GET    /api/transactions/daily-report/:businessId/:date
router.get('/daily-report/:businessId/:date', authenticateToken, getDailyReportByBusiness);

// GET    /api/transactions/get-transaction/:transactionId
router.get('/get-transaction/:transactionId', authenticateToken, getTransactionByTransactionId);

// PUT    /api/transactions/update-transaction/:id
router.put('/update-transaction/:id', authenticateToken, updateTransaction);

// GET    /api/transactions/get-debts/:businessId   — list unpaid debts (add ?includeResolved=true for all)
router.get('/get-debts/:businessId', authenticateToken, getDebtsByBusiness);

// POST/PUT /api/transactions/repay-debt/:id — repay a debt with cash or mpesa
router.post('/repay-debt/:id', authenticateToken, repayDebt);
router.put('/repay-debt/:id', authenticateToken, repayDebt);

export default router;
