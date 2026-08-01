const { storage } = require('../utils/storage.js');
const mpesaService = require('../services/mpesaService.js');

const updateProductStock = async (transaction) => {
    try {
        console.log(`🔄 Updating stock for transaction ${transaction.transactionId}`);
        const updatedProducts = [];

        for (const item of transaction.items) {
        const product = await storage.getProduct(item.productId);
        if (!product) {
            console.warn(`⚠️ Product ${item.productId} not found`);
            continue;
        }

        if (product.stock < item.quantity) {
            console.warn(`⚠️ Insufficient stock for ${product.name}`);
            continue;
        }

        const oldStock = product.stock;
        const newStock = product.stock - item.quantity;
        // pgStorage.updateProduct auto-recalculates status from new stock
        await storage.updateProduct(product.id, { stock: newStock });

        updatedProducts.push({
            productId: product.id,
            name: product.name,
            oldStock,
            newStock,
            quantitySold: item.quantity
        });

        console.log(`✅ ${product.name}: ${oldStock} → ${newStock}`);
        }

        return { success: true, message: `Stock updated for ${updatedProducts.length} products`, updatedProducts };
    } catch (error) {
        console.error('❌ Error updating product stock:', error);
        throw error;
    }
};

exports.initiateStkPush = async(req, res) => {
    try {
        const { phone, amount, transactionId, description, isDebtPayment, businessId } = req.body;

        if (!phone || !amount || !transactionId) {
        return res.status(400).json({ success: false, message: 'Missing required fields: phone, amount, transactionId' });
        }

        let finalBusinessId = businessId;
        const transaction = await storage.getTransaction(transactionId);

        if (!transaction) {
        return res.status(404).json({ success: false, message: 'Transaction not found. Please create transaction first.' });
        }

        if (!finalBusinessId && transaction.businessId) {
        finalBusinessId = transaction.businessId;
        }

        if (transaction.status === 'completed' && transaction.paymentStatus === 'paid') {
        return res.status(400).json({ success: false, message: 'Transaction already completed and paid' });
        }

        if (transaction.paymentMethod !== 'mpesa') {
        await storage.updateTransaction(transactionId, { paymentMethod: 'mpesa' });
        }

        // Normalise phone number to 254XXXXXXXXX
        let formattedPhone = phone.toString().trim().replace(/^\+/, '');
        if (formattedPhone.startsWith('0')) {
        formattedPhone = '254' + formattedPhone.substring(1);
        } else if (/^[71]\d{8}$/.test(formattedPhone)) {
        formattedPhone = '254' + formattedPhone;
        }

        if (!/^254(7|1)\d{8}$/.test(formattedPhone)) {
        return res.status(400).json({
            success: false,
            message: 'Invalid phone number format. Use: 07XXXXXXXX, 01XXXXXXXX, 2547XXXXXXXX, or 2541XXXXXXXX'
        });
        }

        const amountNumber = parseFloat(amount);
        if (amountNumber < 1) {
        return res.status(400).json({ success: false, message: 'Amount must be at least 1 KSh' });
        }

        const finalDescription = description || `Payment for order ${transactionId}`;

        const mpesaResponse = await mpesaService.sendStkPush(
        formattedPhone, amountNumber, transactionId, finalDescription, finalBusinessId
        );

        if (mpesaResponse.ResponseCode === '0') {
        await storage.updateTransaction(transactionId, {
            status: 'pending',
            paymentStatus: 'pending',
            paymentMethod: 'mpesa',
            amountPaid: amountNumber,
            customerPhone: formattedPhone,
            checkoutRequestId: mpesaResponse.CheckoutRequestID,
            merchantRequestId: mpesaResponse.MerchantRequestID,
            businessId: finalBusinessId,
            paymentDetails: {
            checkoutRequestId: mpesaResponse.CheckoutRequestID,
            merchantRequestId: mpesaResponse.MerchantRequestID,
            phone: formattedPhone,
            amount: amountNumber,
            stkResponse: mpesaResponse,
            initiatedAt: new Date(),
            description: finalDescription,
            isDebtRepayment: isDebtPayment === true,
            businessId: finalBusinessId
            },
            errorMessage: null
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
            transactionId,
            status: 'pending',
            isDebtRepayment: isDebtPayment === true,
            businessId: finalBusinessId,
            pollEndpoint: `/api/mpesa/status/${mpesaResponse.CheckoutRequestID}`
            }
        });
        } else {
        await storage.updateTransaction(transactionId, {
            status: 'failed',
            paymentStatus: 'failed',
            errorMessage: mpesaResponse.ResponseDescription || 'STK Push failed'
        });

        return res.status(400).json({
            success: false,
            message: mpesaResponse.ResponseDescription || 'STK Push failed',
            responseCode: mpesaResponse.ResponseCode,
            data: mpesaResponse
        });
        }
    } catch (error) {
        console.error('❌ Error initiating STK Push:', error);

        try {
        const { transactionId } = req.body;
        if (transactionId) {
            await storage.updateTransaction(transactionId, {
            status: 'failed', paymentStatus: 'failed', errorMessage: error.message
            });
        }
        } catch (updateError) {
        console.error('❌ Could not update transaction:', updateError);
        }

        return res.status(500).json({ success: false, message: 'Server error initiating M-PESA payment', error: error.message });
    }
}

exports.handleCallback = async(req, res) => {
    try {
        const callbackData = req.body;
        console.log('📞 M-PESA Callback received:', JSON.stringify(callbackData, null, 2));

        if (!callbackData.Body?.stkCallback) {
        return res.status(200).json({ ResultCode: 0, ResultDesc: 'Success' });
        }

        const stkCallback = callbackData.Body.stkCallback;
        const { ResultCode: resultCode, ResultDesc: resultDesc, CheckoutRequestID: checkoutRequestID } = stkCallback;

        let mpesaReceiptNumber = '', phoneNumber = '', amount = 0, accountReference = '';

        if (stkCallback.CallbackMetadata?.Item) {
        stkCallback.CallbackMetadata.Item.forEach(item => {
            if (item.Name === 'MpesaReceiptNumber') mpesaReceiptNumber = item.Value;
            else if (item.Name === 'PhoneNumber') phoneNumber = item.Value;
            else if (item.Name === 'Amount') amount = item.Value;
            else if (item.Name === 'AccountReference') accountReference = item.Value;
        });
        }

        let transaction = checkoutRequestID
        ? await storage.getTransactionByCheckoutId(checkoutRequestID)
        : null;

        if (!transaction && accountReference) {
        transaction = await storage.getTransaction(accountReference);
        }

        if (!transaction) {
        console.error(`❌ Transaction not found for CheckoutRequestID: ${checkoutRequestID}`);
        return res.status(200).json({ ResultCode: 0, ResultDesc: 'Success' });
        }

        if (transaction.status === 'completed' && transaction.paymentStatus === 'paid') {
        return res.status(200).json({ ResultCode: 0, ResultDesc: 'Success' });
        }

        if (resultCode === 0) {
        const isDebtRepayment =
            transaction.type === 'debt' ||
            transaction.paymentMethod === 'debt' ||
            transaction.paymentDetails?.isDebtRepayment === true;

        const basePaymentDetails = {
            ...(transaction.paymentDetails || {}),
            mpesaReceiptNumber,
            phoneNumber,
            amount: amount || transaction.totalAmount,
            resultCode,
            resultDesc,
            callbackData,
            completedAt: new Date(),
            paymentConfirmedAt: new Date()
        };

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
            errorMessage: null,
            paymentDetails: isDebtRepayment
            ? { ...basePaymentDetails, isDebtRepayment: true, stockUpdated: false, stockUpdateSkipped: true }
            : basePaymentDetails
        };

        if (isDebtRepayment) {
            updateData.debtPaid = true;
            updateData.debtPaymentMethod = 'mpesa';
            updateData.debtPaymentDate = new Date();
        }

        // Single update for the main completion data
        const updatedTransaction = await storage.updateTransactionByUUID(transaction.id, updateData);

        if (isDebtRepayment) {
            console.log('💰 Debt repayment — skipping stock update');
        } else {
            console.log('💰 Regular sale — updating stock');
            try {
            const stockResult = await updateProductStock(updatedTransaction);
            await storage.patchTransactionPaymentDetails(transaction.id, {
                stockUpdated: true,
                stockUpdateResult: stockResult,
                stockUpdateTimestamp: new Date()
            });
            } catch (stockError) {
            console.error('❌ Stock update error:', stockError);
            await storage.patchTransactionPaymentDetails(transaction.id, {
                stockUpdated: false,
                stockUpdateError: stockError.message,
                stockUpdateTimestamp: new Date()
            });
            }
        }
        } else {
        console.log(`❌ Payment failed for ${transaction.transactionId}: ${resultDesc}`);
        await storage.updateTransactionByUUID(transaction.id, {
            status: 'failed',
            paymentStatus: 'failed',
            errorMessage: resultDesc,
            paymentDetails: {
            ...(transaction.paymentDetails || {}),
            resultCode, resultDesc, callbackData, failedAt: new Date()
            }
        });
        }

        res.status(200).json({ ResultCode: 0, ResultDesc: 'Success' });
    } catch (error) {
        console.error('❌ Callback processing error:', error);
        res.status(200).json({ ResultCode: 0, ResultDesc: 'Success' });
    }
}

exports.getTransactionByTransactionId = async(req, res) => {
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
        console.error('❌ Error getting transaction:', error);
        res.status(500).json({ success: false, message: 'Server error fetching transaction', error: error.message });
    }
}

exports.checkPaymentStatus = async(req, res) => {
    try {
        const { checkoutRequestId } = req.params;

        if (!checkoutRequestId) {
        return res.status(400).json({ success: false, message: 'Checkout Request ID is required' });
        }

        const transaction = await storage.getTransactionByCheckoutId(checkoutRequestId);

        if (!transaction) {
        return res.status(404).json({ success: false, message: 'Transaction not found' });
        }

        try {
        const queryResponse = await mpesaService.queryTransactionStatus(checkoutRequestId);
        res.status(200).json({
            success: true,
            transaction,
            mpesaStatus: queryResponse,
            needsAction: transaction.status === 'pending' && transaction.paymentStatus === 'pending',
            isDebtRepayment: transaction.paymentDetails?.isDebtRepayment || false
        });
        } catch (queryError) {
        console.warn('⚠️ Could not query M-Pesa status:', queryError.message);
        res.status(200).json({
            success: true,
            transaction,
            mpesaStatus: null,
            message: 'Using local transaction status',
            isDebtRepayment: transaction.paymentDetails?.isDebtRepayment || false
        });
        }
    } catch (error) {
        console.error('❌ Error checking payment status:', error);
        res.status(500).json({ success: false, message: 'Server error checking payment status', error: error.message });
    }
}

exports.pollTransactionStatus = async(req, res) => {
    try {
        const { transactionId } = req.params;

        const transaction = await storage.getTransaction(transactionId);

        if (!transaction) {
        return res.status(404).json({ success: false, message: 'Transaction not found' });
        }

        res.status(200).json({
        success: true,
        status: transaction.status,
        paymentStatus: transaction.paymentStatus,
        paymentMethod: transaction.paymentMethod,
        mpesaReceipt: transaction.mpesaReceipt,
        checkoutRequestId: transaction.checkoutRequestId,
        amountPaid: transaction.amountPaid,
        errorMessage: transaction.errorMessage,
        isDebtRepayment: transaction.paymentDetails?.isDebtRepayment || false,
        debtPaid: transaction.debtPaid,
        timestamp: new Date()
        });
    } catch (error) {
        console.error('❌ Error polling transaction:', error);
        res.status(500).json({ success: false, message: 'Server error polling transaction', error: error.message });
    }
}