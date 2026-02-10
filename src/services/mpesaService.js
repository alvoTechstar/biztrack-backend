import axios from 'axios';
import 'dotenv/config';

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
const BUSINESS_SHORTCODE = process.env.MPESA_SHORTCODE?.trim() || '174379';
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
      'MPESA_SHORTCODE': BUSINESS_SHORTCODE,
      'MPESA_CALLBACK_URL': CALLBACK_URL
    };

    const missing = Object.entries(required)
      .filter(([key, value]) => !value)
      .map(([key]) => key);

    if (missing.length > 0) {
      console.error('❌ Missing M-PESA configuration:', missing.join(', '));
      if (CALLBACK_URL?.includes('your-domain.com') || CALLBACK_URL?.includes('ngrok')) {
        console.error('⚠️ WARNING: CALLBACK_URL is using placeholder. Update it to your actual URL!');
        console.error('   Callback URL must be publicly accessible for M-PESA to send callbacks.');
      }
    } else {
      console.log('✅ M-PESA configuration validated');
      console.log('📋 Mode:', process.env.MPESA_ENVIRONMENT || 'sandbox');
      console.log('🌐 Callback URL:', CALLBACK_URL);
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
    // Cache token for 55 minutes (M-Pesa tokens expire in 1 hour)
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
      
      console.log('✅ Access token obtained, expires in:', response.data.expires_in, 'seconds');
      
      return this.accessToken;
    } catch (error) {
      console.error('❌ Failed to get access token:', error.message);
      if (error.response) {
        console.error('Status:', error.response.status);
        console.error('Data:', error.response.data);
      }
      throw new Error(`Access token error: ${error.message}`);
    }
  }

  formatPhoneNumber(phone) {
    if (!phone) throw new Error('Phone number is required');
    
    let formatted = phone.toString().trim();
    
    // Remove all non-digit characters
    formatted = formatted.replace(/\D/g, '');
    
    // Format to 254XXXXXXXXX
    if (formatted.startsWith('0')) {
      formatted = '254' + formatted.substring(1);
    } else if (formatted.startsWith('7') && formatted.length === 9) {
      formatted = '254' + formatted;
    } else if (formatted.startsWith('2547') && formatted.length === 12) {
      // Already correct
    } else if (formatted.startsWith('254') && formatted.length === 12) {
      // Already correct but check if starts with 2547
      if (!formatted.startsWith('2547')) {
        throw new Error('Invalid Kenyan phone number. Must start with 2547');
      }
    } else {
      throw new Error(`Invalid phone format: ${phone}. Expected: 07XXXXXXXX or 2547XXXXXXXX`);
    }
    
    // Final validation
    if (!/^2547\d{8}$/.test(formatted)) {
      throw new Error(`Invalid phone number: ${phone}. Must be 12 digits starting with 2547`);
    }
    
    return formatted;
  }

  async sendStkPush(phone, amount, accountReference, description = 'Payment') {
    try {
      console.log('📤 STK Push request:', { phone, amount, accountReference });

      // Validate
      if (!phone || !amount || !accountReference) {
        throw new Error('Missing required parameters');
      }

      if (!PASSKEY) {
        throw new Error('MPESA_PASSKEY not configured');
      }

      if (!CALLBACK_URL) {
        throw new Error('MPESA_CALLBACK_URL not configured');
      }

      // Get token
      const token = await this.getAccessToken();

      // Format phone
      const formattedPhone = this.formatPhoneNumber(phone);
      
      // Generate timestamp and password
      const timestamp = this.generateTimestamp();
      const passwordString = `${BUSINESS_SHORTCODE}${PASSKEY}${timestamp}`;
      const password = Buffer.from(passwordString).toString('base64');

      // Prepare request
      const stkRequest = {
        BusinessShortCode: BUSINESS_SHORTCODE,
        Password: password,
        Timestamp: timestamp,
        TransactionType: 'CustomerPayBillOnline',
        Amount: Math.floor(amount), // M-Pesa requires whole numbers
        PartyA: formattedPhone,
        PartyB: BUSINESS_SHORTCODE,
        PhoneNumber: formattedPhone,
        CallBackURL: CALLBACK_URL,
        AccountReference: accountReference.substring(0, 12), // Max 12 chars
        TransactionDesc: description.substring(0, 13) // Max 13 chars
      };

      console.log('🚀 Sending STK Push to:', MPESA_API_URL);

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

      return response.data;

    } catch (error) {
      console.error('❌ STK Push failed:', error.message);
      
      let errorData = {
        ResponseCode: "500",
        ResponseDescription: "Failed to send STK Push",
        errorMessage: error.message
      };

      if (axios.isAxiosError(error) && error.response) {
        errorData = {
          ResponseCode: error.response.status.toString(),
          ResponseDescription: error.response.data?.errorMessage || error.response.statusText,
          errorMessage: error.response.data?.errorMessage || error.message,
          ...error.response.data
        };
        console.error('📊 Error details:', error.response.data);
      }

      return errorData;
    }
  }

  async queryTransactionStatus(checkoutRequestId) {
    try {
      console.log('🔍 Querying transaction:', checkoutRequestId);

      if (!checkoutRequestId) {
        throw new Error('CheckoutRequestID is required');
      }

      const token = await this.getAccessToken();
      const timestamp = this.generateTimestamp();
      const passwordString = `${BUSINESS_SHORTCODE}${PASSKEY}${timestamp}`;
      const password = Buffer.from(passwordString).toString('base64');

      const payload = {
        BusinessShortCode: BUSINESS_SHORTCODE,
        Password: password,
        Timestamp: timestamp,
        CheckoutRequestID: checkoutRequestId
      };

      console.log('📡 Sending query to:', QUERY_URL);

      const response = await axios.post(QUERY_URL, payload, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      });

      console.log('✅ Query response:', {
        ResultCode: response.data.ResultCode,
        ResultDesc: response.data.ResultDesc
      });

      return response.data;

    } catch (error) {
      console.error('❌ Query failed:', error.message);
      
      let errorData = {
        ResultCode: "500",
        ResultDesc: "Failed to query transaction status",
        errorMessage: error.message
      };

      if (axios.isAxiosError(error) && error.response) {
        errorData = {
          ResultCode: error.response.data?.ResultCode || error.response.status.toString(),
          ResultDesc: error.response.data?.ResultDesc || error.response.statusText,
          ...error.response.data
        };
      }

      throw errorData;
    }
  }
}

export const mpesaService = new MpesaService();