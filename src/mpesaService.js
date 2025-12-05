// backend/src/mpesaService.js
import axios from 'axios';
import 'dotenv/config';

// Use sandbox URLs
const MPESA_API_URL = 'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest';
const AUTH_URL = 'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials';

const CONSUMER_KEY = process.env.MPESA_CONSUMER_KEY?.trim();
const CONSUMER_SECRET = process.env.MPESA_CONSUMER_SECRET?.trim();
const BUSINESS_SHORTCODE = process.env.MPESA_SHORTCODE?.trim() || process.env.MPESA_PAYBILL_NUMBER?.trim() || '174379';
const PASSKEY = process.env.MPESA_PASSKEY?.trim();
const CALLBACK_URL = process.env.MPESA_CALLBACK_URL?.trim() || 'https://your-domain.com/api/mpesa/callback';

class MpesaService {
  /** @type {string | null} */
  accessToken = null;
  /** @type {number} */
  tokenExpiryTime = 0;

  constructor() {
    this.validateConfig();
  }

  /**
   * Validate that all required environment variables are set
   * @private
   */
  validateConfig() {
    const required = {
      'MPESA_CONSUMER_KEY': CONSUMER_KEY,
      'MPESA_CONSUMER_SECRET': CONSUMER_SECRET,
      'MPESA_PASSKEY': PASSKEY,
      'MPESA_SHORTCODE': BUSINESS_SHORTCODE
    };

    const missing = Object.entries(required)
      .filter(([key, value]) => !value)
      .map(([key]) => key);

    if (missing.length > 0) {
      console.error('❌ Missing M-PESA configuration variables:', missing.join(', '));
      console.error('Please check your .env file and ensure all M-PESA variables are set.');
    } else {
      console.log('✅ M-PESA configuration validated successfully');
      console.log('📋 Configuration:', {
        consumerKey: CONSUMER_KEY.substring(0, 10) + '...',
        shortcode: BUSINESS_SHORTCODE,
        callbackUrl: CALLBACK_URL,
        passkeySet: !!PASSKEY
      });
    }
  }

  /**
   * Generate timestamp in M-PESA format: YYYYMMDDHHmmss
   * @private
   * @returns {string} Timestamp in format YYYYMMDDHHmmss
   */
  generateTimestamp() {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    
    const timestamp = `${year}${month}${day}${hours}${minutes}${seconds}`;
    console.log('🕐 Generated timestamp:', timestamp);
    return timestamp;
  }

  /**
   * Retrieves or refreshes the M-Pesa API access token.
   * @private
   * @returns {Promise<string>} The access token.
   * @throws {Error} If the token cannot be obtained.
   */
  async getAccessToken() {
    const now = Date.now();
    // Check if the current token is still valid for at least 30 minutes
    if (this.accessToken && this.tokenExpiryTime > now + (30 * 60 * 1000)) {
      console.log('♻️ Using cached access token');
      return this.accessToken;
    }

    try {
      if (!CONSUMER_KEY || !CONSUMER_SECRET) {
        throw new Error('M-PESA Consumer Key or Secret is missing. Please check your .env file.');
      }

      const auth = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString('base64');
      console.log('🔑 Attempting to get M-Pesa access token...');
      console.log('📍 Auth URL:', AUTH_URL);
      console.log('🔐 Consumer Key (first 10 chars):', CONSUMER_KEY.substring(0, 10) + '...');
      
      const response = await axios.get(AUTH_URL, {
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      });

      this.accessToken = response.data.access_token;
      this.tokenExpiryTime = now + (response.data.expires_in * 1000);
      
      console.log('✅ Successfully obtained M-Pesa access token');
      console.log('⏱️ Token expires in:', response.data.expires_in, 'seconds');
      
      return this.accessToken;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error('❌ Axios error during token fetch:', error.message);
        console.error('📊 Response status:', error.response?.status);
        console.error('📄 Response data:', JSON.stringify(error.response?.data, null, 2));
        console.error('🔍 Request config:', {
          url: error.config?.url,
          method: error.config?.method,
          headers: error.config?.headers
        });
      } else {
        console.error('❌ Unexpected error fetching M-Pesa access token:', error);
      }
      throw new Error('Failed to get M-Pesa access token: ' + (error.response?.data?.error_description || error.message));
    }
  }

  /**
   * Format phone number to 254XXXXXXXXX format
   * @private
   * @param {string} phone - Phone number in various formats
   * @returns {string} Formatted phone number
   */
  formatPhoneNumber(phone) {
    let formatted = phone.toString().trim();
    
    if (formatted.startsWith('+254')) {
      formatted = formatted.substring(1);
    } else if (formatted.startsWith('0')) {
      formatted = '254' + formatted.substring(1);
    } else if (formatted.startsWith('7')) {
      formatted = '254' + formatted;
    }
    
    console.log('📱 Phone formatted:', phone, '→', formatted);
    return formatted;
  }

  /**
   * Sends an STK push request to the M-Pesa API.
   * @param {string} phone - The phone number to send the STK push to.
   * @param {number} amount - The amount to be paid.
   * @param {string} accountReference - A unique identifier for the transaction.
   * @param {string} [description='Payment'] - Transaction description.
   * @returns {Promise<object>} The M-Pesa API response.
   */
  async sendStkPush(phone, amount, accountReference, description = 'Payment') {
    try {
      console.log('📤 sendStkPush parameters:', { phone, amount, accountReference, description });

      // Validate required parameters
      if (!phone || !amount || !accountReference) {
        throw new Error('Missing required parameters for STK push');
      }

      if (!PASSKEY) {
        throw new Error('MPESA_PASSKEY is not configured. Please set it in your .env file.');
      }

      if (!CALLBACK_URL || CALLBACK_URL === 'https://your-domain.com/api/mpesa/callback') {
        console.warn('⚠️ WARNING: Using default callback URL. Please set MPESA_CALLBACK_URL in your .env file.');
      }

      // Get access token
      const token = await this.getAccessToken();

      // Format phone number
      const formattedPhone = this.formatPhoneNumber(phone);

      // Generate timestamp using the correct format
      const timestamp = this.generateTimestamp();

      // Generate password
      const passwordString = `${BUSINESS_SHORTCODE}${PASSKEY}${timestamp}`;
      const password = Buffer.from(passwordString).toString('base64');

      console.log('🔐 Password generation:', {
        shortcode: BUSINESS_SHORTCODE,
        timestamp: timestamp,
        passkeyLength: PASSKEY.length
      });

      // Prepare STK push request
      const stkRequest = {
        BusinessShortCode: BUSINESS_SHORTCODE,
        Password: password,
        Timestamp: timestamp,
        TransactionType: 'CustomerPayBillOnline',
        Amount: Math.round(amount), // Ensure integer
        PartyA: formattedPhone,
        PartyB: BUSINESS_SHORTCODE,
        PhoneNumber: formattedPhone,
        CallBackURL: CALLBACK_URL,
        AccountReference: accountReference,
        TransactionDesc: description
      };

      console.log('📋 STK Push Request Details:', {
        phoneNumber: stkRequest.PhoneNumber,
        amount: stkRequest.Amount,
        accountReference: stkRequest.AccountReference,
        businessShortCode: stkRequest.BusinessShortCode,
        callbackURL: stkRequest.CallBackURL,
        timestamp: stkRequest.Timestamp
      });

      console.log(`🚀 Sending STK Push request to: ${MPESA_API_URL}`);

      const response = await axios.post(MPESA_API_URL, stkRequest, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      });

      console.log('✅ STK Push Success:', response.data);
      return response.data;

    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error('❌ Axios error sending STK Push request:', error.message);
        console.error('📊 Response status:', error.response?.status);
        console.error('📄 Response data:', JSON.stringify(error.response?.data, null, 2));
        
        return {
          ResponseCode: error.response?.status?.toString() || "500",
          ResponseDescription: error.response?.data?.errorMessage || error.response?.statusText || "Failed to communicate with M-Pesa API.",
          errorMessage: error.response?.data?.errorMessage || error.message,
          requestId: error.response?.data?.requestId
        };
      } else {
        console.error('❌ Unexpected error sending STK Push request:', error);
        return {
          ResponseCode: "500",
          ResponseDescription: "An unexpected error occurred.",
          errorMessage: error.message
        };
      }
    }
  }

  /**
   * Query transaction status from M-PESA
   * @param {string} checkoutRequestId - The CheckoutRequestID from STK push
   * @returns {Promise<object>} Transaction status
   */
  async queryTransactionStatus(checkoutRequestId) {
    try {
      console.log('🔍 Querying transaction status:', checkoutRequestId);

      const token = await this.getAccessToken();
      const timestamp = this.generateTimestamp();
      const password = Buffer.from(`${BUSINESS_SHORTCODE}${PASSKEY}${timestamp}`).toString('base64');

      const queryUrl = 'https://sandbox.safaricom.co.ke/mpesa/stkpushquery/v1/query';

      const payload = {
        BusinessShortCode: BUSINESS_SHORTCODE,
        Password: password,
        Timestamp: timestamp,
        CheckoutRequestID: checkoutRequestId
      };

      const response = await axios.post(queryUrl, payload, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      });

      console.log('✅ Query Response:', response.data);
      return response.data;

    } catch (error) {
      console.error('❌ Query Error:', error.response?.data || error.message);
      throw error;
    }
  }
}

export const mpesaService = new MpesaService();