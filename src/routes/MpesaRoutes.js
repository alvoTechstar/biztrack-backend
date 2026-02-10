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

// STK Push initiation (protected route)
// POST /api/mpesa/stk-push
router.post('/stk-push', authenticateToken, initiateStkPush);

// M-PESA callback (public route - called by Safaricom)
// POST /api/mpesa/callback
router.post('/callback', handleCallback);

// Get transaction by transactionId (protected route)
// GET /api/mpesa/transaction/:transactionId
router.get('/transaction/:transactionId', authenticateToken, getTransactionByTransactionId);

// Check payment status by checkoutRequestId (protected route)
// GET /api/mpesa/status/:checkoutRequestId
router.get('/status/:checkoutRequestId', authenticateToken, checkPaymentStatus);

// Poll transaction status (for frontend polling)
// GET /api/mpesa/poll/:transactionId
router.get('/poll/:transactionId', authenticateToken, pollTransactionStatus);

export default router;