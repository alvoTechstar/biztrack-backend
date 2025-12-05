// backend/controllers/MpesaController.js
import { mpesaService } from '../mpesaService.js';
import Transaction from '../models/Transaction.js';

// @desc    Initiate M-PESA STK Push
// @route   POST /api/mpesa/stk-push
// @access  Private
export const initiateStkPush = async (req, res) => {
    try {
        const { phone, amount, kioskId, businessId, transactionId, description } = req.body;

        // FIX: Use kioskId OR businessId (whichever is provided)
        const businessIdentifier = kioskId || businessId;

        // Validate required fields
        if (!phone || !amount || !businessIdentifier || !transactionId) {
            return res.status(400).json({
                success: false,
                message: 'Phone, amount, kioskId/businessId, and transactionId are required'
            });
        }

        // Validate phone number format (Kenyan numbers)
        const phoneRegex = /^(?:254|\+254|0)?(7\d{8})$/;
        if (!phoneRegex.test(phone)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid Kenyan phone number format. Use format: 0712345678 or 254712345678'
            });
        }

        // Format phone number (ensure it's 2547XXXXXXXX)
        let formattedPhone = phone;
        if (phone.startsWith('0')) {
            formattedPhone = '254' + phone.substring(1);
        } else if (phone.startsWith('+254')) {
            formattedPhone = phone.substring(1);
        } else if (phone.startsWith('7')) {
            formattedPhone = '254' + phone;
        }

        // Ensure amount is at least 1
        const amountNumber = parseFloat(amount);
        if (amountNumber < 1) {
            return res.status(400).json({
                success: false,
                message: 'Amount must be at least 1 KSh'
            });
        }

        // Use transactionId as account reference
        const accountReference = transactionId;

        console.log('🔄 Initiating M-PESA STK Push:', {
            phone: formattedPhone,
            amount: amountNumber,
            kioskId: businessIdentifier, // Use the identifier
            transactionId,
            accountReference,
            description: description || 'Payment for goods/services'
        });

        // Call M-PESA service
        const mpesaResponse = await mpesaService.sendStkPush(
            formattedPhone,
            amountNumber,
            accountReference,
            description || 'Payment for goods/services'
        );

        console.log('📱 M-PESA Response:', mpesaResponse);

        if (mpesaResponse.ResponseCode === "0") {
            // Update transaction with M-PESA details
            await Transaction.findOneAndUpdate(
                { transactionId: transactionId },
                {
                    status: 'Initiated',
                    paymentStatus: 'initiated',
                    mpesaDetails: {
                        checkoutRequestId: mpesaResponse.CheckoutRequestID,
                        merchantRequestId: mpesaResponse.MerchantRequestID
                    }
                }
            );

            return res.status(200).json({
                success: true,
                message: 'M-PESA STK Push initiated successfully',
                data: {
                    checkoutRequestId: mpesaResponse.CheckoutRequestID,
                    merchantRequestId: mpesaResponse.MerchantRequestID,
                    customerMessage: mpesaResponse.CustomerMessage,
                    phone: formattedPhone,
                    amount: amountNumber,
                    transactionId: transactionId,
                    status: 'initiated'
                }
            });
        } else {
            // Update transaction as failed
            await Transaction.findOneAndUpdate(
                { transactionId: transactionId },
                {
                    status: 'Failed',
                    paymentStatus: 'failed',
                    errorMessage: mpesaResponse.ResponseDescription || mpesaResponse.errorMessage
                }
            );

            return res.status(400).json({
                success: false,
                message: 'Failed to initiate M-PESA payment',
                error: mpesaResponse.ResponseDescription || mpesaResponse.errorMessage,
                responseCode: mpesaResponse.ResponseCode
            });
        }

    } catch (error) {
        console.error('❌ Error initiating M-PESA STK Push:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error initiating M-PESA payment',
            error: error.message
        });
    }
};

// @desc    Handle M-PESA Callback
// @route   POST /api/mpesa/callback
// @access  Public (M-PESA server calls this)
export const handleCallback = async (req, res) => {
    try {
        const callbackData = req.body;
        console.log('📞 M-PESA Callback received:', JSON.stringify(callbackData, null, 2));

        // Extract data from callback
        const resultCode = callbackData.Body?.stkCallback?.ResultCode;
        const resultDesc = callbackData.Body?.stkCallback?.ResultDesc;
        const checkoutRequestID = callbackData.Body?.stkCallback?.CheckoutRequestID;
        const merchantRequestID = callbackData.Body?.stkCallback?.MerchantRequestID;

        // Extract metadata items
        let mpesaReceiptNumber = '';
        let phoneNumber = '';
        let amount = 0;
        let transactionDate = '';
        let accountReference = '';

        if (callbackData.Body?.stkCallback?.CallbackMetadata?.Item) {
            const items = callbackData.Body.stkCallback.CallbackMetadata.Item;

            items.forEach(item => {
                switch (item.Name) {
                    case 'MpesaReceiptNumber':
                        mpesaReceiptNumber = item.Value || '';
                        break;
                    case 'PhoneNumber':
                        phoneNumber = item.Value || '';
                        break;
                    case 'Amount':
                        amount = item.Value || 0;
                        break;
                    case 'TransactionDate':
                        transactionDate = item.Value || '';
                        break;
                    case 'AccountReference':
                        accountReference = item.Value || '';
                        break;
                }
            });
        }

        console.log('📊 Parsed callback data:', {
            resultCode,
            resultDesc,
            checkoutRequestID,
            merchantRequestID,
            mpesaReceiptNumber,
            phoneNumber,
            amount,
            transactionDate,
            accountReference
        });

        // Update transaction in database
        if (accountReference) {
            const newStatus = resultCode === 0 ? 'Completed' : 'Failed';

            await Transaction.findOneAndUpdate(
                { transactionId: accountReference },
                {
                    status: newStatus,
                    paymentStatus: resultCode === 0 ? 'completed' : 'failed',
                    mpesaReceiptNumber: mpesaReceiptNumber,
                    mpesaDetails: {
                        checkoutRequestId: checkoutRequestID,
                        merchantRequestId: merchantRequestID,
                        callbackData: callbackData
                    },
                    datePaid: resultCode === 0 ? new Date() : null,
                    errorMessage: resultCode !== 0 ? resultDesc : null
                }
            );

            console.log(`✅ Transaction ${accountReference} updated to status: ${newStatus}`);

            if (newStatus === 'Completed') {
                // Get transaction to update stock
                const transaction = await Transaction.findOne({ transactionId: accountReference });
                if (transaction && transaction.items.length > 0) {
                    // Import the updateProductStock function (or move it to a shared module)
                    const Product = await import('../models/Product.js').then(m => m.default);

                    for (const item of transaction.items) {
                        const product = await Product.findById(item.productId);
                        if (product) {
                            product.stock -= item.quantity;

                            if (product.stock <= 0) {
                                product.status = 'Out of Stock';
                            } else if (product.stock <= (product.threshold || 10)) {
                                product.status = 'Low Stock';
                            } else {
                                product.status = 'In Stock';
                            }

                            await product.save();
                        }
                    }
                    console.log(`📦 Stock updated for transaction ${accountReference}`);
                }
            }
        }

        // Always respond to M-PESA with success
        res.status(200).json({
            ResultCode: 0,
            ResultDesc: "Success"
        });

    } catch (error) {
        console.error('❌ Error processing M-PESA callback:', error);

        // Still respond with success to M-PESA to prevent retries
        res.status(200).json({
            ResultCode: 0,
            ResultDesc: "Success"
        });
    }
};

// @desc    Query M-PESA transaction status
// @route   GET /api/mpesa/query-status/:checkoutRequestId
// @access  Private
export const queryTransactionStatus = async (req, res) => {
    try {
        const { checkoutRequestId } = req.params;

        if (!checkoutRequestId) {
            return res.status(400).json({
                success: false,
                message: 'CheckoutRequestId is required'
            });
        }

        const transaction = await Transaction.findOne({
            'mpesaDetails.checkoutRequestId': checkoutRequestId
        });

        if (!transaction) {
            return res.status(404).json({
                success: false,
                message: 'Transaction not found'
            });
        }

        res.status(200).json({
            success: true,
            data: {
                transactionId: transaction.transactionId,
                status: transaction.status,
                paymentStatus: transaction.paymentStatus,
                total: transaction.total,
                mpesaReceiptNumber: transaction.mpesaReceiptNumber,
                timestamp: transaction.timestamp,
                updatedAt: transaction.updatedAt
            }
        });

    } catch (error) {
        console.error('❌ Error querying transaction status:', error);
        res.status(500).json({
            success: false,
            message: 'Server error querying transaction status',
            error: error.message
        });
    }
};