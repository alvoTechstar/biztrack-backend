const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../../middlewares/authMiddleware.js');

const mpesaController = require('../../controllers/mpesaController.js');

router.post('/stk-push', authenticateToken, mpesaController.initiateStkPush);

router.post('/callback', mpesaController.handleCallback);

router.get('/get-transaction/:transactionId', authenticateToken, mpesaController.getTransactionByTransactionId);

router.get('/payment-status/:checkoutRequestId', authenticateToken, mpesaController.checkPaymentStatus);

router.get('/poll-status/:transactionId', authenticateToken, mpesaController.pollTransactionStatus);

module.exports = router;