// src/routes/MpesaRoutes.js
import express from 'express';
import {
    initiateStkPush,
    handleCallback,
    getTransactionByTransactionId,
    checkPaymentStatus,
    pollTransactionStatus
} from '../controllers/MpesaController.js';
import { authenticateToken } from '../middleware/authMiddleware.js';

const router = express.Router();

// POST   /api/mpesa/stk-push
router.post('/stk-push', authenticateToken, initiateStkPush);

// POST   /api/mpesa/callback  (public — called by Safaricom)
router.post('/callback', handleCallback);

// GET    /api/mpesa/get-transaction/:transactionId
router.get('/get-transaction/:transactionId', authenticateToken, getTransactionByTransactionId);

// GET    /api/mpesa/payment-status/:checkoutRequestId
router.get('/payment-status/:checkoutRequestId', authenticateToken, checkPaymentStatus);

// GET    /api/mpesa/poll-status/:transactionId
router.get('/poll-status/:transactionId', authenticateToken, pollTransactionStatus);

export default router;
