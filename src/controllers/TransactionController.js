// controllers/TransactionController.js
import Transaction from '../models/Transaction.js';

// Create transaction (already works with your frontend)
export const createTransaction = async (req, res) => {
  try {
    const transactionData = req.body;

    // Validation
    if (!transactionData.items || !Array.isArray(transactionData.items) || transactionData.items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Transaction items are required'
      });
    }

    if (!transactionData.totalAmount || transactionData.totalAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Valid total amount is required'
      });
    }

    // Validate business information
    if (!transactionData.businessId || !transactionData.businessUUID) {
      return res.status(400).json({
        success: false,
        message: 'Business information is required'
      });
    }

    // Validate shopkeeper information
    if (!transactionData.shopkeeperId || !transactionData.shopkeeperName) {
      return res.status(400).json({
        success: false,
        message: 'Shopkeeper information is required'
      });
    }

    // Normalize data to lowercase
    if (transactionData.status) {
      transactionData.status = transactionData.status.toLowerCase();
    }
    if (transactionData.paymentMethod) {
      transactionData.paymentMethod = transactionData.paymentMethod.toLowerCase();
    }
    if (transactionData.type) {
      transactionData.type = transactionData.type.toLowerCase();
    }

    // Create transaction
    const transaction = new Transaction(transactionData);
    await transaction.save();

    res.status(201).json({
      success: true,
      message: 'Transaction recorded successfully',
      transaction
    });
  } catch (error) {
    console.error('Error creating transaction:', error);
    
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: 'Transaction validation failed',
        errors: messages
      });
    }

    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Transaction ID already exists'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to create transaction',
      error: error.message
    });
  }
};

// NEW: Get transactions by business ID
export const getTransactionsByBusiness = async (req, res) => {
  try {
    const { businessId } = req.params;
    const { 
      startDate, 
      endDate, 
      paymentMethod, 
      status, 
      shopkeeperId,
      limit = 100,
      page = 1 
    } = req.query;
    
    let query = { businessId };
    
    // Date range filter
    if (startDate && endDate) {
      query.timestamp = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }
    
    // Payment method filter
    if (paymentMethod) {
      query.paymentMethod = paymentMethod.toLowerCase();
    }
    
    // Status filter
    if (status) {
      query.status = status.toLowerCase();
    }
    
    // Shopkeeper filter
    if (shopkeeperId) {
      query.shopkeeperId = shopkeeperId;
    }
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const transactions = await Transaction.find(query)
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(parseInt(limit));
    
    const total = await Transaction.countDocuments(query);
    
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
    res.status(500).json({
      success: false,
      message: 'Failed to fetch transactions',
      error: error.message
    });
  }
};

// NEW: Get daily report by business
export const getDailyReportByBusiness = async (req, res) => {
  try {
    const { businessId, date } = req.params;
    const { shopkeeperId } = req.query;
    
    const startDate = new Date(date);
    startDate.setHours(0, 0, 0, 0);
    
    const endDate = new Date(date);
    endDate.setHours(23, 59, 59, 999);
    
    let query = {
      businessId,
      timestamp: { $gte: startDate, $lte: endDate }
    };
    
    // Filter by shopkeeper if provided
    if (shopkeeperId) {
      query.shopkeeperId = shopkeeperId;
    }
    
    const transactions = await Transaction.find(query)
      .sort({ timestamp: -1 });
    
    const completedTransactions = transactions.filter(t => t.status === 'completed');
    const cashTransactions = completedTransactions.filter(t => t.paymentMethod === 'cash');
    const mpesaTransactions = completedTransactions.filter(t => t.paymentMethod === 'mpesa');
    const debtTransactions = transactions.filter(t => t.paymentMethod === 'debt');
    
    // Calculate totals
    const totalRevenue = completedTransactions.reduce((sum, t) => 
      sum + (t.totalAmount || 0), 0
    );
    
    const cashRevenue = cashTransactions.reduce((sum, t) => 
      sum + (t.totalAmount || 0), 0
    );
    
    const mpesaRevenue = mpesaTransactions.reduce((sum, t) => 
      sum + (t.totalAmount || 0), 0
    );
    
    const outstandingDebt = debtTransactions
      .filter(t => t.status === 'pending')
      .reduce((sum, t) => sum + (t.totalAmount || 0), 0);
    
    const totalDebtCollected = debtTransactions
      .filter(t => t.status === 'completed')
      .reduce((sum, t) => sum + (t.totalAmount || 0), 0);
    
    // Product sales summary
    const productSales = {};
    completedTransactions.forEach(transaction => {
      transaction.items.forEach(item => {
        const productName = item.productName;
        const quantity = item.quantity;
        
        if (productSales[productName]) {
          productSales[productName].quantity += quantity;
          productSales[productName].revenue += item.totalPrice;
        } else {
          productSales[productName] = {
            name: productName,
            quantity: quantity,
            revenue: item.totalPrice
          };
        }
      });
    });
    
    const topProducts = Object.values(productSales)
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 5);
    
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
          ? ((debtTransactions.filter(t => t.status === 'completed').length / debtTransactions.length) * 100).toFixed(1)
          : 0,
        topProducts
      }
    });
  } catch (error) {
    console.error('Error generating daily report by business:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate daily report',
      error: error.message
    });
  }
};

// Get all transactions (for debugging)
export const getAllTransactions = async (req, res) => {
  try {
    const { limit = 100 } = req.query;
    
    const transactions = await Transaction.find({})
      .sort({ timestamp: -1 })
      .limit(parseInt(limit));
    
    res.json({
      success: true,
      transactions,
      count: transactions.length
    });
  } catch (error) {
    console.error('Error fetching all transactions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch transactions',
      error: error.message
    });
  }
};

// Update transaction (for debt payment)
export const updateTransaction = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    // Find the transaction
    const transaction = await Transaction.findById(id);
    
    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }

    // Validate that this is a debt transaction
    if (transaction.paymentMethod !== 'debt' && transaction.originalPaymentMethod !== 'debt') {
      return res.status(400).json({
        success: false,
        message: 'Only debt transactions can be updated for payment'
      });
    }

    // Check if already paid
    if (transaction.status === 'completed' || transaction.debtPaid) {
      return res.status(400).json({
        success: false,
        message: 'This debt has already been paid'
      });
    }

    // Normalize payment method to lowercase
    if (updateData.paymentMethod) {
      updateData.paymentMethod = updateData.paymentMethod.toLowerCase();
    }

    // Normalize other fields to lowercase if needed
    if (updateData.status) {
      updateData.status = updateData.status.toLowerCase();
    }
    
    if (updateData.paymentStatus) {
      updateData.paymentStatus = updateData.paymentStatus.toLowerCase();
    }

    // Prepare update data
    const updates = {
      status: 'completed',
      paymentStatus: 'paid',
      debtPaid: true,
      updatedAt: new Date(),
      ...updateData
    };

    // Add payment date if not provided
    if (!updates.datePaid && !updates.paidAt) {
      updates.datePaid = new Date();
      updates.paidAt = new Date();
    }

    // Update the transaction
    const updatedTransaction = await Transaction.findByIdAndUpdate(
      id,
      { $set: updates },
      { new: true, runValidators: true }
    );

    res.json({
      success: true,
      message: 'Debt payment recorded successfully',
      transaction: updatedTransaction
    });
  } catch (error) {
    console.error('Error updating transaction:', error);
    
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: 'Update validation failed',
        errors: messages
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to update transaction',
      error: error.message
    });
  }
};