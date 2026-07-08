// controllers/TransactionController.js
import { storage } from '../storage.js';
import { mpesaService } from '../services/mpesaService.js';

function normalizePhone(phone) {
  let p = phone.toString().trim().replace(/^\+/, '');
  if (p.startsWith('0')) p = '254' + p.substring(1);
  else if (/^[71]\d{8}$/.test(p)) p = '254' + p;
  return p;
}

function isValidKenyanPhone(phone) {
  return /^254(7|1)\d{8}$/.test(phone);
}

// ─── Hotel payment: atomically create a Transaction and complete the Order ───

async function createHotelPayment(req, res) {
  const body = req.body;
  const { orderId: orderUUID, orderNumber, businessId, amount, paymentMethod,
          cashReceived, change, mpesaPhone, mpesaReceiptNumber, cashierName } = body;

  if (!amount || Number(amount) <= 0) {
    return res.status(400).json({ success: false, message: 'Valid amount is required' });
  }
  if (!paymentMethod || !['cash', 'mpesa'].includes(paymentMethod.toLowerCase())) {
    return res.status(400).json({ success: false, message: 'paymentMethod must be "cash" or "mpesa"' });
  }

  const order = await storage.getOrder(orderUUID);
  if (!order) {
    return res.status(404).json({ success: false, message: 'Order not found' });
  }
  if (['completed', 'cancelled'].includes(order.status)) {
    return res.status(400).json({
      success: false,
      message: `Order is already ${order.status}`
    });
  }

  const method = paymentMethod.toLowerCase();

  if (method === 'mpesa' && mpesaPhone) {
    const normalized = normalizePhone(String(mpesaPhone));
    if (!isValidKenyanPhone(normalized)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid M-Pesa phone. Use: 07XXXXXXXX, 01XXXXXXXX, 2547XXXXXXXX, or 2541XXXXXXXX'
      });
    }
  }

  const staffName = cashierName
    || `${req.user?.firstName ?? ''} ${req.user?.lastName ?? ''}`.trim()
    || 'Cashier';

  const txData = {
    transactionId: `PAY-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    businessId: String(businessId || order.businessId),
    businessUUID: req.user?.businessUUID || String(businessId || order.businessId),
    businessName: order.businessName ?? null,
    businessType: order.businessType ?? null,
    shopkeeperId: req.user?.id || 'system',
    shopkeeperName: staffName,
    shopkeeperRole: req.user?.role || 'Hotel_Cashier',
    totalAmount: Number(amount),
    type: 'sale',
    paymentMethod: method,
    status: 'completed',
    paymentStatus: 'paid',
    amountPaid: Number(amount),
    change: Number(change) || 0,
    cashReceived: cashReceived ? Number(cashReceived) : null,
    customerPhone: mpesaPhone ? normalizePhone(String(mpesaPhone)) : null,
    mpesaReceipt: mpesaReceiptNumber || null,
    completedAt: new Date(),
    datePaid: new Date(),
    paidAt: new Date(),
    // Order linkage
    orderId: order.id,
    orderNumber: orderNumber || order.orderId,
    paymentDetails: {
      cashierName: staffName,
      cashReceived: cashReceived ?? null,
      change: change ?? 0,
      mpesaPhone: mpesaPhone ?? null,
      mpesaReceiptNumber: mpesaReceiptNumber ?? null,
    },
    items: [],  // payment record has no items — items live on the Order
  };

  const { transaction, order: completedOrder } = await storage.createPaymentTransaction(txData, order.id);

  return res.status(201).json({
    success: true,
    message: 'Payment processed successfully',
    transaction: {
      _id: transaction.id,
      ...transaction,
    },
    order: {
      _id: completedOrder.id,
      ...completedOrder,
    },
  });
}

// ─── Kiosk/legacy sale ────────────────────────────────────────────────────────

async function createKioskSale(req, res) {
  const body = req.body;

  const totalAmount = Number(body.totalAmount ?? body.total);
  const transactionId =
    body.transactionId ??
    body.orderId ??
    `TXN-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const businessUUID =
    body.businessUUID ?? req.user?.businessUUID ?? String(body.businessId ?? '');
  const shopkeeperId = body.shopkeeperId ?? req.user?.id ?? '';
  const shopkeeperName =
    body.shopkeeperName ??
    body.waiter ??
    `${req.user?.firstName ?? ''} ${req.user?.lastName ?? ''}`.trim();
  const shopkeeperRole = body.shopkeeperRole ?? req.user?.role ?? 'Kiosk_Shopkeeper';
  const paymentMethod = body.paymentMethod ?? '';

  if (!body.items || !Array.isArray(body.items) || body.items.length === 0) {
    return res.status(400).json({ success: false, message: 'Transaction items are required' });
  }
  if (!totalAmount || totalAmount <= 0) {
    return res.status(400).json({ success: false, message: 'Valid total amount is required' });
  }
  if (!body.businessId) {
    return res.status(400).json({ success: false, message: 'Business information is required' });
  }

  const items = body.items.map(item => ({
    productId: item.productId ?? item.id ?? '',
    productName: item.productName ?? item.name ?? '',
    quantity: Number(item.quantity) || 1,
    unit: item.unit ?? 'units',
    unitPrice: Number(item.unitPrice ?? item.price) || 0,
    totalPrice:
      Number(item.totalPrice) ||
      Number(item.unitPrice ?? item.price ?? 0) * Number(item.quantity ?? 1),
    ...(item.category != null ? { category: item.category } : {}),
  }));

  const transactionData = {
    transactionId,
    businessId: body.businessId,
    businessUUID,
    businessName: body.businessName,
    businessType: body.businessType,
    shopkeeperId,
    shopkeeperName,
    shopkeeperEmail: body.shopkeeperEmail,
    shopkeeperPhone: body.shopkeeperPhone,
    shopkeeperRole,
    tableNumber: body.tableNumber,
    totalAmount,
    type: (body.type ?? 'sale').toLowerCase(),
    paymentMethod,
    status: (body.status ?? 'pending').toLowerCase(),
    paymentStatus: (body.paymentStatus ?? 'pending').toLowerCase(),
    amountPaid: Number(body.amountPaid) || 0,
    change: Number(body.change) || 0,
    customerPhone: body.customerPhone,
    customerName: body.customerName ?? '',
    notes: body.notes ?? body.note,
    debtPaid: body.debtPaid ?? false,
    items,
  };

  if (transactionData.paymentMethod === 'debt') {
    if (!body.customerName?.trim()) {
      return res.status(400).json({ success: false, message: 'Customer name is required for debt sales' });
    }
    if (!body.customerPhone?.trim()) {
      return res.status(400).json({ success: false, message: 'Customer phone number is required for debt sales' });
    }
    const normalized = normalizePhone(body.customerPhone);
    if (!isValidKenyanPhone(normalized)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid customer phone. Use: 07XXXXXXXX, 01XXXXXXXX, 2547XXXXXXXX, or 2541XXXXXXXX'
      });
    }
    transactionData.customerPhone = normalized;
    transactionData.type = 'sale';
    transactionData.status = 'pending';
    transactionData.paymentStatus = 'pending';
    transactionData.debtPaid = false;
    transactionData.amountPaid = 0;
    transactionData.change = 0;
  }

  const transaction = await storage.createTransaction(transactionData);
  return res.status(201).json({ success: true, message: 'Transaction recorded successfully', transaction });
}

// ─── Public handlers ──────────────────────────────────────────────────────────

export const createTransaction = async (req, res) => {
  try {
    // Hotel payment: orderId is the UUID of an Order record
    if (req.body.orderId && !req.body.transactionId && !req.body.items) {
      return await createHotelPayment(req, res);
    }
    // Kiosk / legacy sale
    return await createKioskSale(req, res);
  } catch (error) {
    console.error('Error creating transaction:', error);
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

    // For hotel transactions, enrich with order data
    const enriched = await Promise.all(
      transactions.map(async (t) => {
        if (!t.orderId) return { _id: t.id, ...t };
        const order = await storage.getOrder(t.orderId).catch(() => null);
        return {
          _id: t.id,
          ...t,
          order: order
            ? { tableNumber: order.tableNumber, items: order.items, waiter: order.waiter }
            : null,
        };
      })
    );

    res.json({
      success: true,
      data: enriched,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit)),
      count: enriched.length
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

    const cash  = transactions.filter(t => t.paymentMethod === 'cash');
    const mpesa = transactions.filter(t => t.paymentMethod === 'mpesa');
    const totalRevenue = transactions.reduce((s, t) => s + (t.totalAmount || 0), 0);
    const cashTotal    = cash.reduce((s, t) => s + (t.totalAmount || 0), 0);
    const mpesaTotal   = mpesa.reduce((s, t) => s + (t.totalAmount || 0), 0);

    // topProduct: from transaction items (kiosk) or skip for hotel
    const productSales = {};
    transactions.forEach(t => {
      (t.items || []).forEach(item => {
        const key = item.productName;
        productSales[key] = (productSales[key] || 0) + item.quantity;
      });
    });
    const topProduct = Object.entries(productSales).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    res.json({
      success: true,
      data: {
        date,
        totalTransactions: transactions.length,
        totalRevenue,
        mpesaCount: mpesa.length,
        mpesaTotal,
        cashCount: cash.length,
        cashTotal,
        topProduct,
        transactions,
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
    res.json({ success: true, data: transactions, count: transactions.length });
  } catch (error) {
    console.error('Error fetching all transactions:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch transactions', error: error.message });
  }
};

export const updateTransaction = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    const transaction = await storage.getTransactionByUUID(id);
    if (!transaction) {
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }

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
      data: debts,
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
