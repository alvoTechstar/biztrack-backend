// controllers/TransactionController.js
import { storage } from '../storage.js';
import { mpesaService } from '../services/mpesaService.js';

// Normalise a Kenyan phone number to 254XXXXXXXXX
function normalizePhone(phone) {
  let p = phone.toString().trim().replace(/^\+/, '');
  if (p.startsWith('0')) p = '254' + p.substring(1);
  else if (/^[71]\d{8}$/.test(p)) p = '254' + p;
  return p;
}

function isValidKenyanPhone(phone) {
  return /^254(7|1)\d{8}$/.test(phone);
}

export const createTransaction = async (req, res) => {
  try {
    const transactionData = req.body;

    if (!transactionData.items || !Array.isArray(transactionData.items) || transactionData.items.length === 0) {
      return res.status(400).json({ success: false, message: 'Transaction items are required' });
    }

    if (!transactionData.totalAmount || transactionData.totalAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Valid total amount is required' });
    }

    if (!transactionData.businessId || !transactionData.businessUUID) {
      return res.status(400).json({ success: false, message: 'Business information is required' });
    }

    if (!transactionData.shopkeeperId || !transactionData.shopkeeperName) {
      return res.status(400).json({ success: false, message: 'Shopkeeper information is required' });
    }

    if (transactionData.status) transactionData.status = transactionData.status.toLowerCase();
    if (transactionData.paymentMethod) transactionData.paymentMethod = transactionData.paymentMethod.toLowerCase();
    if (transactionData.type) transactionData.type = transactionData.type.toLowerCase();

    // ── Debt sale validation ──────────────────────────────────────────────────
    if (transactionData.paymentMethod === 'debt') {
      if (!transactionData.customerName || !transactionData.customerName.trim()) {
        return res.status(400).json({ success: false, message: 'Customer name is required for debt sales' });
      }
      if (!transactionData.customerPhone || !transactionData.customerPhone.trim()) {
        return res.status(400).json({ success: false, message: 'Customer phone number is required for debt sales' });
      }
      const normalized = normalizePhone(transactionData.customerPhone);
      if (!isValidKenyanPhone(normalized)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid customer phone. Use: 07XXXXXXXX, 01XXXXXXXX, 2547XXXXXXXX, or 2541XXXXXXXX'
        });
      }
      // Enforce debt defaults — goods leave the shop but payment is pending
      transactionData.customerPhone = normalized;
      transactionData.type = 'sale';
      transactionData.status = 'pending';
      transactionData.paymentStatus = 'pending';
      transactionData.debtPaid = false;
      transactionData.amountPaid = 0;
      transactionData.change = 0;
    }

    const transaction = await storage.createTransaction(transactionData);

    res.status(201).json({ success: true, message: 'Transaction recorded successfully', transaction });
  } catch (error) {
    console.error('Error creating transaction:', error);

    // P2002 = unique constraint (transactionId already exists)
    if (error.code === 'P2002') {
      return res.status(400).json({ success: false, message: 'Transaction ID already exists' });
    }

    res.status(500).json({ success: false, message: 'Failed to create transaction', error: error.message });
  }
};

export const getTransactionsByBusiness = async (req, res) => {
  try {
    const { businessId } = req.params;
    const { startDate, endDate, paymentMethod, status, shopkeeperId, limit = 100, page = 1 } = req.query;

    const where = { businessId };

    if (startDate && endDate) {
      where.timestamp = { gte: new Date(startDate), lte: new Date(endDate) };
    }
    if (paymentMethod) where.paymentMethod = paymentMethod.toLowerCase();
    if (status) where.status = status.toLowerCase();
    if (shopkeeperId) where.shopkeeperId = shopkeeperId;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [transactions, total] = await Promise.all([
      storage.queryTransactions(where, { skip, take: parseInt(limit) }),
      storage.countTransactions(where)
    ]);

    res.json({
      success: true,
      transactions,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit)),
      count: transactions.length
    });
  } catch (error) {
    console.error('Error fetching transactions by business:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch transactions', error: error.message });
  }
};

export const getDailyReportByBusiness = async (req, res) => {
  try {
    const { businessId, date } = req.params;
    const { shopkeeperId } = req.query;

    const startDate = new Date(date);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(date);
    endDate.setHours(23, 59, 59, 999);

    const where = { businessId, timestamp: { gte: startDate, lte: endDate } };
    if (shopkeeperId) where.shopkeeperId = shopkeeperId;

    const transactions = await storage.queryTransactions(where, { take: 10000 });

    const completedTransactions = transactions.filter(t => t.status === 'completed');
    const cashTransactions = completedTransactions.filter(t => t.paymentMethod === 'cash');
    const mpesaTransactions = completedTransactions.filter(t => t.paymentMethod === 'mpesa');
    const debtTransactions = transactions.filter(t => t.paymentMethod === 'debt' || t.type === 'debt');

    const totalRevenue = completedTransactions.reduce((sum, t) => sum + (t.totalAmount || 0), 0);
    const cashRevenue = cashTransactions.reduce((sum, t) => sum + (t.totalAmount || 0), 0);
    const mpesaRevenue = mpesaTransactions.reduce((sum, t) => sum + (t.totalAmount || 0), 0);
    const outstandingDebt = debtTransactions
      .filter(t => t.status === 'pending' || !t.debtPaid)
      .reduce((sum, t) => sum + (t.totalAmount || 0), 0);
    const totalDebtCollected = debtTransactions
      .filter(t => t.status === 'completed' && t.debtPaid)
      .reduce((sum, t) => sum + (t.totalAmount || 0), 0);

    const productSales = {};
    completedTransactions.forEach(t => {
      t.items.forEach(item => {
        if (productSales[item.productName]) {
          productSales[item.productName].quantity += item.quantity;
          productSales[item.productName].revenue += item.totalPrice;
        } else {
          productSales[item.productName] = { name: item.productName, quantity: item.quantity, revenue: item.totalPrice };
        }
      });
    });

    const topProducts = Object.values(productSales).sort((a, b) => b.quantity - a.quantity).slice(0, 5);

    res.json({
      success: true,
      date,
      transactions,
      summary: {
        totalTransactions: transactions.length,
        completedTransactions: completedTransactions.length,
        totalRevenue,
        cashRevenue,
        mpesaRevenue,
        debtTransactions: debtTransactions.length,
        outstandingDebt,
        totalDebtCollected,
        debtRecoveryRate: debtTransactions.length > 0
          ? ((debtTransactions.filter(t => t.status === 'completed' && t.debtPaid).length / debtTransactions.length) * 100).toFixed(1)
          : 0,
        topProducts
      }
    });
  } catch (error) {
    console.error('Error generating daily report by business:', error);
    res.status(500).json({ success: false, message: 'Failed to generate daily report', error: error.message });
  }
};

export const getAllTransactions = async (req, res) => {
  try {
    const { limit = 100 } = req.query;
    const transactions = await storage.queryTransactions({}, { take: parseInt(limit) });
    res.json({ success: true, transactions, count: transactions.length });
  } catch (error) {
    console.error('Error fetching all transactions:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch transactions', error: error.message });
  }
};

export const updateTransaction = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    // id here is the Prisma UUID primary key (replaces MongoDB _id)
    const transaction = await storage.getTransactionByUUID(id);

    if (!transaction) {
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }

    const shouldSkipStockUpdate =
      updateData.skipStockUpdate === true ||
      updateData.isDebtPaymentCompletion === true ||
      (transaction.type === 'debt' && updateData.debtPaid === true);

    const isDebtPaymentCompletion = transaction.type === 'debt' && updateData.debtPaid === true;

    const isMpesaInitiation =
      updateData.paymentMethod === 'mpesa' &&
      updateData.paymentStatus === 'pending' &&
      updateData.status === 'pending';

    if (transaction.type === 'debt' && !isMpesaInitiation) {
      if (transaction.status === 'completed' && transaction.debtPaid === true) {
        return res.status(400).json({ success: false, message: 'This debt has already been paid' });
      }
    }

    if (updateData.paymentMethod) updateData.paymentMethod = updateData.paymentMethod.toLowerCase();
    if (updateData.status) updateData.status = updateData.status.toLowerCase();
    if (updateData.paymentStatus) updateData.paymentStatus = updateData.paymentStatus.toLowerCase();
    if (updateData.debtPaymentMethod) updateData.debtPaymentMethod = updateData.debtPaymentMethod.toLowerCase();

    const paymentDate = updateData.datePaid || updateData.paidAt || updateData.paymentDate || updateData.completedAt || new Date();

    const updates = { ...updateData, updatedAt: new Date() };

    if (isDebtPaymentCompletion) {
      updates.status = 'completed';
      updates.paymentStatus = 'paid';
      updates.debtPaid = true;
      updates.datePaid = paymentDate;
      updates.paidAt = paymentDate;
      updates.paymentDate = paymentDate;
      updates.completedAt = paymentDate;
      updates.paymentDetails = {
        ...(transaction.paymentDetails || {}),
        ...(updateData.paymentDetails || {}),
        isDebtRepayment: true,
        stockUpdated: false,
        stockUpdateSkipped: true,
        reason: 'Debt payment - stock already updated during original sale'
      };
    } else if (transaction.paymentMethod === 'mpesa' && updateData.status === 'completed') {
      updates.datePaid = paymentDate;
      updates.paidAt = paymentDate;
      updates.paymentDate = paymentDate;
      updates.completedAt = paymentDate;

      if (transaction.type === 'debt') {
        updates.debtPaid = true;
        updates.debtPaymentMethod = 'mpesa';
        updates.debtPaymentDate = paymentDate;
        updates.paymentDetails = {
          ...(transaction.paymentDetails || {}),
          ...(updateData.paymentDetails || {}),
          isDebtRepayment: true,
          stockUpdated: false,
          stockUpdateSkipped: true
        };
      }
    }

    if (updateData.paymentDetails && !isDebtPaymentCompletion) {
      updates.paymentDetails = {
        ...(transaction.paymentDetails || {}),
        ...updateData.paymentDetails,
        ...(updates.paymentDetails || {})
      };
    }

    // Remove fields not in the Prisma schema
    delete updates.skipStockUpdate;
    delete updates.isDebtPaymentCompletion;

    const updatedTransaction = await storage.updateTransactionByUUID(id, updates);

    res.json({
      success: true,
      message: transaction.type === 'debt' ? 'Debt payment recorded successfully' : 'Transaction updated successfully',
      transaction: updatedTransaction
    });
  } catch (error) {
    console.error('❌ Error updating transaction:', error);
    res.status(500).json({ success: false, message: 'Failed to update transaction', error: error.message });
  }
};

export const getTransactionByTransactionId = async (req, res) => {
  try {
    const { transactionId } = req.params;

    if (!transactionId) {
      return res.status(400).json({ success: false, message: 'Transaction ID is required' });
    }

    const transaction = await storage.getTransaction(transactionId);

    if (!transaction) {
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }

    res.status(200).json({ success: true, transaction });
  } catch (error) {
    console.error('❌ Error fetching transaction by transactionId:', error);
    res.status(500).json({ success: false, message: 'Server error fetching transaction', error: error.message });
  }
};

export const updateMpesaTransaction = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    const transaction = await storage.getTransactionByUUID(id);

    if (!transaction) {
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }

    if (transaction.paymentMethod !== 'mpesa') {
      return res.status(400).json({ success: false, message: 'Only MPesa transactions can be updated with this endpoint' });
    }

    const updates = { ...updateData };

    if (updates.status === 'completed' || updates.paymentStatus === 'paid') {
      const paymentDate = new Date();
      updates.datePaid = paymentDate;
      updates.paidAt = paymentDate;
      updates.paymentDate = paymentDate;
      updates.completedAt = paymentDate;
    }

    const updatedTransaction = await storage.updateTransactionByUUID(id, updates);

    res.json({ success: true, message: 'MPesa transaction updated successfully', transaction: updatedTransaction });
  } catch (error) {
    console.error('❌ Error updating MPesa transaction:', error);
    res.status(500).json({ success: false, message: 'Failed to update MPesa transaction', error: error.message });
  }
};

// ─── GET /api/transactions/get-debts/:businessId ──────────────────────────────
export const getDebtsByBusiness = async (req, res) => {
  try {
    const { businessId } = req.params;
    const includeResolved = req.query.includeResolved === 'true';

    const debts = await storage.getDebtsByBusiness(businessId, includeResolved);

    const outstanding = debts.filter(d => !d.debtPaid);
    const resolved    = debts.filter(d => d.debtPaid);
    const totalOutstanding = outstanding.reduce((s, d) => s + (d.totalAmount || 0), 0);

    res.json({
      success: true,
      debts,
      count: debts.length,
      outstanding: outstanding.length,
      resolved: resolved.length,
      totalOutstanding
    });
  } catch (error) {
    console.error('❌ Error fetching debts:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch debts', error: error.message });
  }
};

// ─── POST /api/transactions/repay-debt/:id ────────────────────────────────────
// :id is the Prisma UUID of the debt transaction
export const repayDebt = async (req, res) => {
  try {
    const { id } = req.params;
    const { paymentMethod, amountPaid, phone, notes } = req.body;

    if (!paymentMethod || !['cash', 'mpesa'].includes(paymentMethod.toLowerCase())) {
      return res.status(400).json({ success: false, message: 'paymentMethod must be "cash" or "mpesa"' });
    }

    const transaction = await storage.getTransactionByUUID(id);
    if (!transaction) {
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }
    if (transaction.paymentMethod !== 'debt') {
      return res.status(400).json({ success: false, message: 'This transaction is not a debt sale' });
    }
    if (transaction.debtPaid) {
      return res.status(400).json({ success: false, message: 'This debt has already been paid' });
    }

    const method = paymentMethod.toLowerCase();
    const amount = parseFloat(amountPaid || transaction.totalAmount);

    // ── Cash repayment: complete immediately ──────────────────────────────────
    if (method === 'cash') {
      const now = new Date();
      const updated = await storage.updateTransactionByUUID(id, {
        status: 'completed',
        paymentStatus: 'paid',
        debtPaid: true,
        debtPaymentMethod: 'cash',
        debtPaymentDate: now,
        amountPaid: amount,
        datePaid: now,
        paidAt: now,
        paymentDate: now,
        completedAt: now,
        notes: notes || transaction.notes,
        paymentDetails: {
          ...(transaction.paymentDetails || {}),
          isDebtRepayment: true,
          repaidWith: 'cash',
          repaidAt: now,
          stockUpdated: false,
          stockUpdateSkipped: true,
          reason: 'Debt repayment — stock was deducted at point of sale'
        }
      });
      return res.json({ success: true, message: 'Debt repaid successfully with cash', transaction: updated });
    }

    // ── M-PESA repayment: initiate STK push ───────────────────────────────────
    if (!phone) {
      return res.status(400).json({ success: false, message: 'Phone number is required for M-PESA repayment' });
    }
    const formattedPhone = normalizePhone(phone);
    if (!isValidKenyanPhone(formattedPhone)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid phone number. Use: 07XXXXXXXX, 01XXXXXXXX, 2547XXXXXXXX, or 2541XXXXXXXX'
      });
    }
    if (amount < 1) {
      return res.status(400).json({ success: false, message: 'Amount must be at least KSh 1' });
    }

    const mpesaResponse = await mpesaService.sendStkPush(
      formattedPhone,
      amount,
      transaction.transactionId,
      `Debt repayment: ${transaction.transactionId}`,
      transaction.businessId
    );

    if (mpesaResponse.ResponseCode === '0') {
      await storage.updateTransactionByUUID(id, {
        amountPaid: amount,
        customerPhone: formattedPhone,
        checkoutRequestId: mpesaResponse.CheckoutRequestID,
        merchantRequestId: mpesaResponse.MerchantRequestID,
        paymentDetails: {
          ...(transaction.paymentDetails || {}),
          isDebtRepayment: true,
          repaidWith: 'mpesa',
          checkoutRequestId: mpesaResponse.CheckoutRequestID,
          merchantRequestId: mpesaResponse.MerchantRequestID,
          phone: formattedPhone,
          amount,
          initiatedAt: new Date()
        }
      });

      return res.json({
        success: true,
        message: 'M-PESA STK push sent. Awaiting customer confirmation.',
        data: {
          checkoutRequestId: mpesaResponse.CheckoutRequestID,
          merchantRequestId: mpesaResponse.MerchantRequestID,
          customerMessage: mpesaResponse.CustomerMessage,
          phone: formattedPhone,
          amount,
          transactionId: transaction.transactionId,
          status: 'pending',
          isDebtRepayment: true,
          pollEndpoint: `/api/transactions/get-transaction/${transaction.transactionId}`
        }
      });
    }

    return res.status(400).json({
      success: false,
      message: mpesaResponse.ResponseDescription || 'M-PESA STK push failed',
      responseCode: mpesaResponse.ResponseCode
    });

  } catch (error) {
    console.error('❌ Error repaying debt:', error);
    res.status(500).json({ success: false, message: 'Failed to repay debt', error: error.message });
  }
};
