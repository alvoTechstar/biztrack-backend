const axios = require('axios');
require('dotenv').config();
const storage = require('../utils/storage.js');


// Configuration
const MPESA_API_URL = process.env.MPESA_ENVIRONMENT === 'production'
  ? 'https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest'
  : 'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest';

const AUTH_URL = process.env.MPESA_ENVIRONMENT === 'production'
  ? 'https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials'
  : 'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials';

const QUERY_URL = process.env.MPESA_ENVIRONMENT === 'production'
  ? 'https://api.safaricom.co.ke/mpesa/stkpushquery/v1/query'
  : 'https://sandbox.safaricom.co.ke/mpesa/stkpushquery/v1/query';

const CONSUMER_KEY = process.env.MPESA_CONSUMER_KEY?.trim();
const CONSUMER_SECRET = process.env.MPESA_CONSUMER_SECRET?.trim();
const DEFAULT_SHORTCODE = process.env.MPESA_SHORTCODE?.trim() || '174379';
const PASSKEY = process.env.MPESA_PASSKEY?.trim();
const CALLBACK_URL = process.env.MPESA_CALLBACK_URL?.trim();

class MpesaService {
    accessToken = null;
    tokenExpiryTime = 0;

    constructor() {
        this.validateConfig();
    }

    validateConfig() {
        const required = {
        'MPESA_CONSUMER_KEY': CONSUMER_KEY,
        'MPESA_CONSUMER_SECRET': CONSUMER_SECRET,
        'MPESA_PASSKEY': PASSKEY,
        'MPESA_CALLBACK_URL': CALLBACK_URL
        };

        const missing = Object.entries(required)
        .filter(([key, value]) => !value)
        .map(([key]) => key);

        if (missing.length > 0) {
        console.error('❌ Missing M-PESA configuration:', missing.join(', '));
        } else {
        console.log('✅ M-PESA configuration validated');
        console.log('📋 Mode:', process.env.MPESA_ENVIRONMENT || 'sandbox');
        }
    }

    generateTimestamp() {
        const date = new Date();
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const seconds = String(date.getSeconds()).padStart(2, '0');

        return `${year}${month}${day}${hours}${minutes}${seconds}`;
    }

    async getAccessToken() {
        const now = Date.now();
        if (this.accessToken && this.tokenExpiryTime > now + (5 * 60 * 1000)) {
            console.log('♻️ Using cached access token');
            return this.accessToken;
        }

        try {
            if (!CONSUMER_KEY || !CONSUMER_SECRET) {
                throw new Error('M-PESA credentials missing');
            }

            const auth = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString('base64');

            console.log('🔑 Getting M-Pesa access token...');

            const response = await axios.get(AUTH_URL, {
                headers: {
                'Authorization': `Basic ${auth}`,
                'Accept': 'application/json'
                },
                timeout: 10000
            });

            this.accessToken = response.data.access_token;
            this.tokenExpiryTime = now + (response.data.expires_in * 1000);

            console.log('✅ Access token obtained');

            return this.accessToken;
        } catch (error) {
            console.error('❌ Failed to get access token:', error.message);
            throw new Error(`Access token error: ${error.message}`);
        }
    }

    /**
     * Get business payment configuration by businessId
     */
    async getBusinessPaymentConfig(businessId) {
        try {
            console.log(`🔍 Fetching payment config for business: ${businessId}`);
            
            const business = await storage.getBusiness(businessId);
            
            if (!business) {
                console.warn(`⚠️ Business not found: ${businessId}, using default config`);
                return {
                paymentType: 'TILL',
                tillNumber: null,
                paybillNumber: null,
                accountNumber: null,
                pochiNumber: null
                };
            }
            
            const businessObj = business.toObject ? business.toObject() : business;
            
            const config = businessObj.paymentConfig || {
                paymentType: 'TILL',
                tillNumber: null,
                paybillNumber: null,
                accountNumber: null,
                pochiNumber: null
            };

            console.log(`✅ Found payment config:`, config);

            return config;
        } catch (error) {
            console.error('❌ Error fetching business payment config:', error);
            return {
                paymentType: 'TILL',
                tillNumber: null,
                paybillNumber: null,
                accountNumber: null,
                pochiNumber: null
            };
        }
    }

    /**
     * Get all payment details from config
     */
    getPaymentDetailsFromConfig(config) {
        const details = {
        businessShortCode: null,
        accountReference: null,
        transactionType: null,
        partyB: null
        };

        switch (config.paymentType) {
        case 'PAYBILL':
            details.businessShortCode = config.paybillNumber;
            details.accountReference = config.accountNumber;
            details.transactionType = 'CustomerPayBillOnline';
            details.partyB = config.paybillNumber; // For paybill, PartyB is the paybill number
            break;
            
        case 'TILL':
            details.businessShortCode = config.tillNumber;
            details.accountReference = 'TILL'; // For till, account reference can be something like "TILL" or transaction ID
            details.transactionType = 'CustomerBuyGoodsOnline';
            details.partyB = config.tillNumber; // For till, PartyB is the till number
            break;
            
        case 'POCHI':
            details.businessShortCode = config.pochiNumber;
            details.accountReference = 'POCHI'; // For pochi, adjust as needed
            details.transactionType = 'CustomerPayBillOnline'; // Pochi usually uses paybill transaction type
            details.partyB = config.pochiNumber;
            break;
            
        default:
            details.businessShortCode = DEFAULT_SHORTCODE;
            details.accountReference = 'PAYMENT';
            details.transactionType = 'CustomerPayBillOnline';
            details.partyB = DEFAULT_SHORTCODE;
        }

        return details;
    }

    formatPhoneNumber(phone) {
        if (!phone) throw new Error('Phone number is required');

        let formatted = phone.toString().trim();
        formatted = formatted.replace(/\D/g, '');

        if (formatted.length < 9) {
            throw new Error(`Phone number too short: ${phone}`);
        }

        if (formatted.startsWith('0')) {
            if (formatted.length === 10) {
                formatted = '254' + formatted.substring(1);
            } else {
                throw new Error(`Invalid phone format: ${phone}`);
            }
        } else if ((formatted.startsWith('7') || formatted.startsWith('1')) && formatted.length === 9) {
            formatted = '254' + formatted;
        } else if ((formatted.startsWith('2547') || formatted.startsWith('2541')) && formatted.length === 12) {
            // Already correct
        } else {
            throw new Error(`Invalid phone format: ${phone}`);
        }

        if (!/^254(7|1)\d{8}$/.test(formatted)) {
            throw new Error(`Invalid phone number format: ${formatted}`);
        }

        return formatted;
    }

    async sendStkPush(phone, amount, transactionId, description = 'Payment', businessId = null) {
        try {
            console.log('📤 STK Push request:', { 
                phone, 
                amount, 
                transactionId, 
                businessId: businessId || 'default' 
            });

            if (!phone || !amount || !transactionId) {
                throw new Error('Missing required parameters');
            }

            if (!PASSKEY) {
                throw new Error('MPESA_PASSKEY not configured');
            }

            if (!CALLBACK_URL) {
                throw new Error('MPESA_CALLBACK_URL not configured');
            }

            // Get payment config
            let paymentDetails;
            let config;

            if (businessId) {
                config = await this.getBusinessPaymentConfig(businessId);
                paymentDetails = this.getPaymentDetailsFromConfig(config);
                console.log('💰 Using business payment config:', {
                paymentType: config.paymentType,
                ...paymentDetails
                });
            } else {
                // Use default config
                paymentDetails = {
                businessShortCode: DEFAULT_SHORTCODE,
                accountReference: transactionId.substring(0, 12),
                transactionType: 'CustomerPayBillOnline',
                partyB: DEFAULT_SHORTCODE
                };
                console.log('⚠️ No business ID, using default config');
            }

            // Get token
            const token = await this.getAccessToken();

            // Format phone
            const formattedPhone = this.formatPhoneNumber(phone);

            // Generate timestamp and password
            const timestamp = this.generateTimestamp();
            const passwordString = `${paymentDetails.businessShortCode}${PASSKEY}${timestamp}`;
            const password = Buffer.from(passwordString).toString('base64');

            // Prepare request
            const stkRequest = {
                BusinessShortCode: paymentDetails.businessShortCode,
                Password: password,
                Timestamp: timestamp,
                TransactionType: paymentDetails.transactionType,
                Amount: Math.floor(amount),
                PartyA: formattedPhone,
                PartyB: paymentDetails.partyB,
                PhoneNumber: formattedPhone,
                CallBackURL: CALLBACK_URL,
                AccountReference: paymentDetails.accountReference.substring(0, 12),
                TransactionDesc: description.substring(0, 13)
            };

            console.log('🚀 Sending STK Push with payment config:');
            console.log('   Payment Type:', config?.paymentType || 'DEFAULT');
            console.log('   BusinessShortCode:', paymentDetails.businessShortCode);
            console.log('   TransactionType:', paymentDetails.transactionType);
            console.log('   AccountReference:', paymentDetails.accountReference.substring(0, 12));
            console.log('   PartyB:', paymentDetails.partyB);
            console.log('   Amount:', amount);

            const response = await axios.post(MPESA_API_URL, stkRequest, {
                headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
                },
                timeout: 30000
            });

            console.log('✅ STK Push response:', {
                ResponseCode: response.data.ResponseCode,
                CustomerMessage: response.data.CustomerMessage,
                CheckoutRequestID: response.data.CheckoutRequestID
            });

            // Add business info to response
            response.data.businessId = businessId;
            response.data.paymentConfig = config;
            response.data.paymentDetails = paymentDetails;

            return response.data;

        } catch (error) {
            console.error('❌ STK Push failed:', error.message);

            let errorData = {
                ResponseCode: "500",
                ResponseDescription: "Failed to send STK Push",
                errorMessage: error.message,
                businessId
            };

            if (axios.isAxiosError(error) && error.response) {
                console.error('📊 M-PESA Error Details:', error.response.data);
                errorData = {
                ...error.response.data,
                businessId
                };
            }

            return errorData;
        }
    }

    async queryTransactionStatus(checkoutRequestId, businessId = null) {
        try {
            console.log('🔍 Querying transaction:', { checkoutRequestId, businessId });

            if (!checkoutRequestId) {
                throw new Error('CheckoutRequestID is required');
            }

            // Get business shortcode
            let businessShortCode = DEFAULT_SHORTCODE;
            if (businessId) {
                const config = await this.getBusinessPaymentConfig(businessId);
                const paymentDetails = this.getPaymentDetailsFromConfig(config);
                businessShortCode = paymentDetails.businessShortCode;
            }

            const token = await this.getAccessToken();
            const timestamp = this.generateTimestamp();
            const passwordString = `${businessShortCode}${PASSKEY}${timestamp}`;
            const password = Buffer.from(passwordString).toString('base64');

            const payload = {
                BusinessShortCode: businessShortCode,
                Password: password,
                Timestamp: timestamp,
                CheckoutRequestID: checkoutRequestId
            };

            console.log('📡 Querying transaction status');

            const response = await axios.post(QUERY_URL, payload, {
                headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
                },
                timeout: 15000
            });

            return response.data;

        } catch (error) {
            console.error('❌ Query failed:', error.message);
            throw error;
        }
    }
}

const mpesaService = new MpesaService();

module.exports = { mpesaService };