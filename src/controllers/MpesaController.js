import { mpesaService } from '../services/mpesaService.js';
import Transaction from '../models/Transaction.js';
import Product from '../models/Product.js';

// Helper function to update stock
const updateProductStock = async (transaction) => {
  try {
    console.log(`🔄 Updating stock for transaction ${transaction.transactionId}`);

    let updatedProducts = [];

    for (const item of transaction.items) {
      const product = await Product.findById(item.productId);
      if (!product) {
        console.warn(`⚠️ Product ${item.productId} not found`);
        continue;
      }

      const currentStock = product.stock;
      const quantityToDeduct = item.quantity;

      if (currentStock < quantityToDeduct) {
        console.warn(`⚠️ Insufficient stock for ${product.name}`);
        continue;
      }

      product.stock -= quantityToDeduct;

      if (product.stock <= 0) {
        product.status = 'Out of Stock';
      } else if (product.stock <= (product.threshold || 10)) {
        product.status = 'Low Stock';
      } else {
        product.status = 'In Stock';
      }

      await product.save();
      updatedProducts.push({
        productId: product._id,
        name: product.name,
        oldStock: currentStock,
        newStock: product.stock,
        quantitySold: quantityToDeduct
      });

      console.log(`✅ ${product.name}: ${currentStock} → ${product.stock}`);
    }

    return {
      success: true,
      message: `Stock updated for ${updatedProducts.length} products`,
      updatedProducts
    };
  } catch (error) {
    console.error('❌ Error updating product stock:', error);
    throw error;
  }
};

// @desc    Initiate M-PESA STK Push
// @route   POST /api/mpesa/stk-push
// @access  Private
export const initiateStkPush = async (req, res) => {
  try {
    const { phone, amount, transactionId, description, isDebtPayment } = req.body;

    console.log('📥 STK Push Request:', { 
      phone, 
      amount, 
      transactionId, 
      isDebtPayment: isDebtPayment || false 
    });

    // Validate required fields
    if (!phone || !amount || !transactionId) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: phone, amount, transactionId'
      });
    }

    // Find the transaction
    const transaction = await Transaction.findOne({ transactionId });
    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found. Please create transaction first.'
      });
    }

    // Check if already processed
    if (transaction.status === 'completed' && transaction.paymentStatus === 'paid') {
      return res.status(400).json({
        success: false,
        message: 'Transaction already completed and paid'
      });
    }

    // Ensure payment method is mpesa
    if (transaction.paymentMethod !== 'mpesa') {
      await Transaction.findOneAndUpdate(
        { transactionId },
        { paymentMethod: 'mpesa' }
      );
    }

    // Format phone number - UPDATED to handle 01 and 2541 numbers
    let formattedPhone = phone.toString().trim();

    // Remove + if present
    if (formattedPhone.startsWith('+')) {
      formattedPhone = formattedPhone.substring(1);
    }

    // Handle different formats
    if (formattedPhone.startsWith('0')) {
      // 07XXXXXXXX or 01XXXXXXXX → 2547XXXXXXXX or 2541XXXXXXXX
      formattedPhone = '254' + formattedPhone.substring(1);
    } else if (formattedPhone.startsWith('7') && formattedPhone.length === 9) {
      // 7XXXXXXXX → 2547XXXXXXXX
      formattedPhone = '254' + formattedPhone;
    } else if (formattedPhone.startsWith('1') && formattedPhone.length === 9) {
      // 1XXXXXXXX → 2541XXXXXXXX
      formattedPhone = '254' + formattedPhone;
    }
    // 2547XXXXXXXX or 2541XXXXXXXX already in correct format

    console.log('📱 Phone formatting:', {
      original: phone,
      formatted: formattedPhone,
      isValid: /^254(7|1)\d{8}$/.test(formattedPhone)
    });

    // Validate phone number format - UPDATED to accept 2541 numbers
    if (!/^254(7|1)\d{8}$/.test(formattedPhone)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid phone number format. Use format: 07XXXXXXXX, 01XXXXXXXX, 2547XXXXXXXX, or 2541XXXXXXXX'
      });
    }

    // Validate amount
    const amountNumber = parseFloat(amount);
    if (amountNumber < 1) {
      return res.status(400).json({
        success: false,
        message: 'Amount must be at least 1 KSh'
      });
    }

    // Ensure amount matches transaction
    if (amountNumber !== transaction.totalAmount) {
      console.warn(`⚠️ Amount mismatch: ${amountNumber} vs ${transaction.totalAmount}`);
    }

    const accountReference = transactionId;
    const finalDescription = description || `Payment for order ${transactionId}`;

    console.log('🔄 Sending STK Push:', {
      phone: formattedPhone,
      amount: amountNumber,
      transactionId,
      accountReference,
      isDebtPayment: isDebtPayment || false
    });

    // Send STK Push
    const mpesaResponse = await mpesaService.sendStkPush(
      formattedPhone,
      amountNumber,
      accountReference,
      finalDescription
    );

    console.log('📱 M-PESA Response:', mpesaResponse);

    if (mpesaResponse.ResponseCode === "0") {
      // Success - update transaction
      const updatedTransaction = await Transaction.findOneAndUpdate(
        { transactionId },
        {
          status: 'pending',
          paymentStatus: 'pending',
          paymentMethod: 'mpesa',
          amountPaid: amountNumber,
          customerPhone: formattedPhone,
          checkoutRequestId: mpesaResponse.CheckoutRequestID,
          merchantRequestId: mpesaResponse.MerchantRequestID,
          // Store the debt payment flag in the transaction
          isDebtRepayment: isDebtPayment === true,
          paymentDetails: {
            checkoutRequestId: mpesaResponse.CheckoutRequestID,
            merchantRequestId: mpesaResponse.MerchantRequestID,
            phone: formattedPhone,
            amount: amountNumber,
            stkResponse: mpesaResponse,
            initiatedAt: new Date(),
            description: finalDescription,
            isDebtRepayment: isDebtPayment === true
          },
          errorMessage: null
        },
        { new: true }
      );

      console.log('✅ STK Push successful:', {
        transactionId,
        checkoutRequestId: mpesaResponse.CheckoutRequestID,
        isDebtRepayment: isDebtPayment === true
      });

      return res.status(200).json({
        success: true,
        message: 'STK Push sent successfully',
        data: {
          checkoutRequestId: mpesaResponse.CheckoutRequestID,
          merchantRequestId: mpesaResponse.MerchantRequestID,
          customerMessage: mpesaResponse.CustomerMessage,
          phone: formattedPhone,
          amount: amountNumber,
          transactionId: transactionId,
          status: 'pending',
          isDebtRepayment: isDebtPayment === true,
          // For frontend polling
          pollEndpoint: `/api/mpesa/status/${mpesaResponse.CheckoutRequestID}`
        }
      });
    } else {
      // Failed - update transaction
      await Transaction.findOneAndUpdate(
        { transactionId },
        {
          status: 'failed',
          paymentStatus: 'failed',
          paymentMethod: 'mpesa',
          errorMessage: mpesaResponse.ResponseDescription || 'STK Push failed'
        }
      );

      console.error('❌ STK Push failed:', mpesaResponse.ResponseDescription);

      return res.status(400).json({
        success: false,
        message: mpesaResponse.ResponseDescription || 'STK Push failed',
        responseCode: mpesaResponse.ResponseCode,
        data: mpesaResponse
      });
    }

  } catch (error) {
    console.error('❌ Error initiating STK Push:', error);
    
    // Try to mark transaction as failed
    try {
      const { transactionId } = req.body;
      if (transactionId) {
        await Transaction.findOneAndUpdate(
          { transactionId },
          {
            status: 'failed',
            paymentStatus: 'failed',
            errorMessage: error.message
          }
        );
      }
    } catch (updateError) {
      console.error('❌ Could not update transaction:', updateError);
    }

    return res.status(500).json({
      success: false,
      message: 'Server error initiating M-PESA payment',
      error: error.message
    });
  }
};

// @desc    Handle M-PESA Callback
// @route   POST /api/mpesa/callback
// @access  Public
export const handleCallback = async (req, res) => {
  try {
    const callbackData = req.body;
    console.log('📞 M-PESA Callback received:', JSON.stringify(callbackData, null, 2));

    // Validate callback structure
    if (!callbackData.Body?.stkCallback) {
      console.error('❌ Invalid callback structure');
      return res.status(200).json({ 
        ResultCode: 0, 
        ResultDesc: "Success" 
      });
    }

    const stkCallback = callbackData.Body.stkCallback;
    const resultCode = stkCallback.ResultCode;
    const resultDesc = stkCallback.ResultDesc;
    const checkoutRequestID = stkCallback.CheckoutRequestID;

    console.log('🔍 Callback details:', {
      resultCode,
      resultDesc,
      checkoutRequestID
    });

    let mpesaReceiptNumber = '';
    let phoneNumber = '';
    let amount = 0;
    let accountReference = '';

    // Extract metadata if available
    if (stkCallback.CallbackMetadata?.Item) {
      const items = stkCallback.CallbackMetadata.Item;
      items.forEach(item => {
        switch (item.Name) {
          case 'MpesaReceiptNumber':
            mpesaReceiptNumber = item.Value;
            break;
          case 'PhoneNumber':
            phoneNumber = item.Value;
            break;
          case 'Amount':
            amount = item.Value;
            break;
          case 'AccountReference':
            accountReference = item.Value;
            break;
        }
      });
    }

    // Find transaction by checkoutRequestId (more reliable)
    let transaction;
    if (checkoutRequestID) {
      transaction = await Transaction.findOne({ checkoutRequestId: checkoutRequestID });
    }
    
    // Fallback to accountReference if checkoutRequestId not found
    if (!transaction && accountReference) {
      transaction = await Transaction.findOne({ transactionId: accountReference });
    }

    if (!transaction) {
      console.error(`❌ Transaction not found for CheckoutRequestID: ${checkoutRequestID}, AccountReference: ${accountReference}`);
      return res.status(200).json({ 
        ResultCode: 0, 
        ResultDesc: "Success" 
      });
    }

    console.log(`🔍 Found transaction: ${transaction.transactionId}`, {
      type: transaction.type,
      paymentMethod: transaction.paymentMethod,
      isDebtRepayment: transaction.isDebtRepayment || false,
      debtPaid: transaction.debtPaid
    });

    // Check if already processed
    if (transaction.status === 'completed' && transaction.paymentStatus === 'paid') {
      console.log(`ℹ️ Transaction ${transaction.transactionId} already completed`);
      return res.status(200).json({ 
        ResultCode: 0, 
        ResultDesc: "Success" 
      });
    }

    if (resultCode === 0) {
      // Payment successful
      console.log(`✅ Payment successful for ${transaction.transactionId}`, {
        mpesaReceiptNumber,
        amount,
        phoneNumber
      });

      const updateData = {
        status: 'completed',
        paymentStatus: 'paid',
        paymentMethod: 'mpesa',
        mpesaReceipt: mpesaReceiptNumber,
        amountPaid: amount || transaction.totalAmount,
        datePaid: new Date(),
        paidAt: new Date(),
        paymentDate: new Date(),
        completedAt: new Date(),
        customerPhone: phoneNumber || transaction.customerPhone,
        paymentDetails: {
          ...transaction.paymentDetails,
          mpesaReceiptNumber,
          phoneNumber,
          amount: amount || transaction.totalAmount,
          resultCode,
          resultDesc,
          callbackData: callbackData,
          completedAt: new Date(),
          paymentConfirmedAt: new Date()
        },
        errorMessage: null
      };

      // ✅ CRITICAL: Check if this is a debt repayment
      const isDebtRepayment = 
        transaction.type === 'debt' || 
        transaction.paymentMethod === 'debt' ||
        transaction.transactionType === 'debt' ||
        transaction.isDebtRepayment === true ||
        transaction.paymentDetails?.isDebtRepayment === true;

      // If this is a debt repayment, mark debt as paid
      if (isDebtRepayment) {
        updateData.debtPaid = true;
        updateData.debtPaymentMethod = 'mpesa';
        updateData.debtPaymentDate = new Date();
        
        // Add skip stock update flag
        updateData.skipStockUpdate = true;
        
        // Update payment details
        updateData.paymentDetails = {
          ...updateData.paymentDetails,
          isDebtRepayment: true,
          stockUpdated: false,
          stockUpdateSkipped: true,
          reason: 'Debt payment - stock already updated during original sale'
        };
      }

      // Update transaction
      const updatedTransaction = await Transaction.findByIdAndUpdate(
        transaction._id,
        updateData,
        { new: true }
      );

      console.log(`✅ Transaction ${transaction.transactionId} marked as completed`, {
        isDebtRepayment,
        debtPaid: updatedTransaction.debtPaid,
        skipStockUpdate: updatedTransaction.skipStockUpdate
      });

      // ✅ CRITICAL FIX: Only update stock if this is NOT a debt repayment
      if (isDebtRepayment) {
        console.log('💰 Processing DEBT REPAYMENT - SKIPPING stock update (stock already updated during original sale)');
        
        // Update transaction with skip info
        await Transaction.findByIdAndUpdate(transaction._id, {
          'paymentDetails.stockUpdated': false,
          'paymentDetails.stockUpdateSkipped': true,
          'paymentDetails.skipReason': 'Debt repayment - stock already updated',
          'paymentDetails.skipTimestamp': new Date()
        });
      } else {
        // Regular sale - UPDATE STOCK
        console.log('💰 Processing regular sale - UPDATING stock');
        try {
          const stockUpdateResult = await updateProductStock(updatedTransaction);
          console.log(`📦 Stock updated:`, stockUpdateResult.message);
          
          // Update transaction with stock update info
          await Transaction.findByIdAndUpdate(transaction._id, {
            'paymentDetails.stockUpdated': true,
            'paymentDetails.stockUpdateResult': stockUpdateResult,
            'paymentDetails.stockUpdateTimestamp': new Date()
          });
        } catch (stockError) {
          console.error(`❌ Stock update error:`, stockError);
          // Don't fail the callback - just log the error
          await Transaction.findByIdAndUpdate(transaction._id, {
            'paymentDetails.stockUpdated': false,
            'paymentDetails.stockUpdateError': stockError.message,
            'paymentDetails.stockUpdateTimestamp': new Date()
          });
        }
      }

      // Emit real-time event if using WebSockets
      // if (io) {
      //   io.emit(`payment:${transaction.transactionId}`, {
      //     status: 'completed',
      //     receipt: mpesaReceiptNumber,
      //     transactionId: transaction.transactionId,
      //     isDebtRepayment,
      //     timestamp: new Date()
      //   });
      // }

    } else {
      // Payment failed
      console.log(`❌ Payment failed for ${transaction.transactionId}: ${resultDesc}`);

      const updateData = {
        status: 'failed',
        paymentStatus: 'failed',
        errorMessage: resultDesc,
        paymentDetails: {
          ...transaction.paymentDetails,
          resultCode,
          resultDesc,
          callbackData: callbackData,
          failedAt: new Date()
        }
      };

      await Transaction.findByIdAndUpdate(transaction._id, updateData);

      // Emit failure event
      // if (io) {
      //   io.emit(`payment:${transaction.transactionId}`, {
      //     status: 'failed',
      //     error: resultDesc,
      //     transactionId: transaction.transactionId,
      //     timestamp: new Date()
      //   });
      // }
    }

    // Always return success to M-PESA
    res.status(200).json({
      ResultCode: 0,
      ResultDesc: "Success"
    });

  } catch (error) {
    console.error('❌ Callback processing error:', error);
    // Still return success to prevent M-PESA retries
    res.status(200).json({
      ResultCode: 0,
      ResultDesc: "Success"
    });
  }
};

// @desc    Get transaction by transactionId
// @route   GET /api/mpesa/transaction/:transactionId
// @access  Private
export const getTransactionByTransactionId = async (req, res) => {
  try {
    const { transactionId } = req.params;

    console.log('🔍 Getting transaction by ID:', transactionId);

    if (!transactionId) {
      return res.status(400).json({
        success: false,
        message: 'Transaction ID is required'
      });
    }

    const transaction = await Transaction.findOne({ transactionId })
      .populate('items.productId', 'name sku price stock');

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }

    console.log('📊 Transaction found:', {
      transactionId: transaction.transactionId,
      status: transaction.status,
      paymentStatus: transaction.paymentStatus,
      paymentMethod: transaction.paymentMethod,
      type: transaction.type,
      isDebtRepayment: transaction.isDebtRepayment || false,
      debtPaid: transaction.debtPaid
    });

    res.status(200).json({
      success: true,
      transaction: transaction
    });

  } catch (error) {
    console.error('❌ Error getting transaction:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching transaction',
      error: error.message
    });
  }
};

// @desc    Check payment status by checkoutRequestId
// @route   GET /api/mpesa/status/:checkoutRequestId
// @access  Private
export const checkPaymentStatus = async (req, res) => {
  try {
    const { checkoutRequestId } = req.params;

    console.log('🔍 Checking payment status:', checkoutRequestId);

    if (!checkoutRequestId) {
      return res.status(400).json({
        success: false,
        message: 'Checkout Request ID is required'
      });
    }

    // Find transaction
    const transaction = await Transaction.findOne({ checkoutRequestId });

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }

    // Query M-Pesa directly for status
    try {
      const queryResponse = await mpesaService.queryTransactionStatus(checkoutRequestId);
      
      res.status(200).json({
        success: true,
        transaction: transaction,
        mpesaStatus: queryResponse,
        needsAction: transaction.status === 'pending' && transaction.paymentStatus === 'pending',
        isDebtRepayment: transaction.isDebtRepayment || false
      });
    } catch (queryError) {
      // If query fails, just return current transaction status
      console.warn('⚠️ Could not query M-Pesa status:', queryError.message);
      
      res.status(200).json({
        success: true,
        transaction: transaction,
        mpesaStatus: null,
        message: 'Using local transaction status',
        isDebtRepayment: transaction.isDebtRepayment || false
      });
    }

  } catch (error) {
    console.error('❌ Error checking payment status:', error);
    res.status(500).json({
      success: false,
      message: 'Server error checking payment status',
      error: error.message
    });
  }
};

// @desc    Poll transaction status (for frontend polling)
// @route   GET /api/mpesa/poll/:transactionId
// @access  Private
export const pollTransactionStatus = async (req, res) => {
  try {
    const { transactionId } = req.params;

    console.log('🔄 Polling transaction status:', transactionId);

    const transaction = await Transaction.findOne({ transactionId });

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }

    // Return current status
    res.status(200).json({
      success: true,
      status: transaction.status,
      paymentStatus: transaction.paymentStatus,
      paymentMethod: transaction.paymentMethod,
      mpesaReceipt: transaction.mpesaReceipt,
      checkoutRequestId: transaction.checkoutRequestId,
      amountPaid: transaction.amountPaid,
      errorMessage: transaction.errorMessage,
      isDebtRepayment: transaction.isDebtRepayment || false,
      debtPaid: transaction.debtPaid,
      timestamp: new Date()
    });

  } catch (error) {
    console.error('❌ Error polling transaction:', error);
    res.status(500).json({
      success: false,
      message: 'Server error polling transaction',
      error: error.message
    });
  }
};