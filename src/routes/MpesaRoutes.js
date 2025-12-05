// backend/routes/MpesaRoutes.js
import express from 'express';
import {
    initiateStkPush,
    handleCallback,
    queryTransactionStatus
} from '../controllers/MpesaController.js';
import { authenticateToken } from '../middleware/authMiddleware.js';

const router = express.Router();

// STK Push initiation (protected route)
router.post('/stk-push', authenticateToken, initiateStkPush);

// M-PESA callback (public route - called by Safaricom)
router.post('/callback', handleCallback);

// Query transaction status (protected route)
router.get('/query-status/:checkoutRequestId', authenticateToken, queryTransactionStatus);

export default router;