// backend/routes/TransactionRoutes.js
import express from 'express';
import {
  createTransaction,
  getTransactionsByBusiness,
  getDailyReportByBusiness,
  getAllTransactions,
  updateTransaction // ADD THIS IMPORT
} from '../../controllers/TransactionController.js';
import { authenticateToken } from '../../middleware/authMiddleware.js';

const router = express.Router();

router.use(authenticateToken);

// Create transaction
router.route('/')
  .post(createTransaction)
  .get(getAllTransactions); // GET all transactions

// Update transaction (for debt payments)
router.route('/:id')
  .put(updateTransaction); // ADD THIS ROUTE

// Get transactions by business ID
router.route('/business/:businessId')
  .get(getTransactionsByBusiness);

// Get daily report by business
router.route('/report/business/:businessId/:date')
  .get(getDailyReportByBusiness);

export default router;