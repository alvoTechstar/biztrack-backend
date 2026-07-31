const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../../middlewares/authMiddleware.js');

const transactionController = require('../../controllers/transactionController.js');

router.post('/create-transaction', authenticateToken, transactionController.createTransaction);
router.get('/get-all-transactions', authenticateToken, transactionController.getAllTransactions);
router.get('/get-transactions/:businessId', authenticateToken, transactionController.getTransactionsByBusiness);
router.get('/daily-report/:businessId/:date', authenticateToken, transactionController.getDailyReportByBusiness);
router.get('/get-transaction/:transactionId', authenticateToken, transactionController.getTransactionByTransactionId);
router.put('/update-transaction/:id', authenticateToken, transactionController.updateTransaction);
router.get('/get-debts/:businessId', authenticateToken, transactionController.getDebtsByBusiness);

router.post('/repay-debt/:id', authenticateToken, transactionController.repayDebt);
router.put('/repay-debt/:id', authenticateToken, transactionController.repayDebt);

module.exports = router