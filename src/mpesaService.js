import axios from 'axios';
import 'dotenv/config';

// Use sandbox URLs
const MPESA_API_URL = 'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest';
const AUTH_URL = 'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials';

const CONSUMER_KEY = process.env.MPESA_CONSUMER_KEY;
const CONSUMER_SECRET = process.env.MPESA_CONSUMER_SECRET;
const BUSINESS_SHORTCODE = process.env.MPESA_PAYBILL_NUMBER || '174379';
const PASSKEY = process.env.MPESA_PASSKEY;
const CALLBACK_URL = process.env.MPESA_CALLBACK_URL || 'https://your-domain.com/api/mpesa-callback';

class MpesaService {
  /** @type {string | null} */
  accessToken = null;
  /** @type {number} */
  tokenExpiryTime = 0;

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
      return this.accessToken;
    }

    try {
      const auth = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString('base64');
      console.log('Attempting to get M-Pesa access token...');
      const response = await axios.get(AUTH_URL, {
        headers: {
          'Authorization': `Basic ${auth}`
        },
        timeout: 30000
      });

      this.accessToken = response.data.access_token;
      this.tokenExpiryTime = now + (response.data.expires_in * 1000);
      console.log('Successfully obtained M-Pesa access token.');
      return this.accessToken;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error('Axios error during token fetch:', error.message);
        console.error('Response status:', error.response?.status);
        console.error('Response data:', error.response?.data);
      } else {
        console.error('Unexpected error fetching M-Pesa access token:', error);
      }
      throw new Error('Failed to get M-Pesa access token.');
    }
  }

  /**
   * Sends an STK push request to the M-Pesa API.
   * @param {string} phone The phone number to send the STK push to.
   * @param {number} amount The amount to be paid.
   * @param {string} accountReference A unique identifier for the transaction.
   * @returns {Promise<object>} The M-Pesa API response.
   */
  async sendStkPush(phone, amount, accountReference) {
    try {
      console.log('sendStkPush parameters:', { phone, amount, accountReference });

      if (!phone || !amount || !accountReference) {
        throw new Error('Missing required parameters for STK push');
      }

      const token = await this.getAccessToken();

      // Generate timestamp and password
      const timestamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, -3);
      const password = Buffer.from(`${BUSINESS_SHORTCODE}${PASSKEY}${timestamp}`).toString('base64');

      const stkRequest = {
        BusinessShortCode: BUSINESS_SHORTCODE,
        Password: password,
        Timestamp: timestamp,
        TransactionType: 'CustomerPayBillOnline',
        Amount: amount.toString(),
        PartyA: phone,
        PartyB: BUSINESS_SHORTCODE,
        PhoneNumber: phone,
        CallBackURL: CALLBACK_URL,
        AccountReference: accountReference,
        TransactionDesc: 'Church Offering'
      };

      console.log(`Sending STK Push request to: ${MPESA_API_URL}`);
      console.log('STK Push Request Details:', {
        phoneNumber: stkRequest.PhoneNumber,
        amount: stkRequest.Amount,
        accountReference: stkRequest.AccountReference,
        businessShortCode: stkRequest.BusinessShortCode,
        callbackURL: stkRequest.CallBackURL
      });

      const response = await axios.post(MPESA_API_URL, stkRequest, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      });

      console.log('STK Push Success:', response.data);
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error('Axios error sending STK Push request:', error.message);
        console.error('Response status:', error.response?.status);
        console.error('Response data:', error.response?.data);
        return {
          ResponseCode: error.response?.status?.toString() || "500",
          ResponseDescription: error.response?.statusText || "Failed to communicate with M-Pesa API.",
          errorMessage: error.message,
          requestId: error.response?.data?.requestId
        };
      } else {
        console.error('Unexpected error sending STK Push request:', error);
        return {
          ResponseCode: "500",
          ResponseDescription: "An unexpected error occurred.",
          errorMessage: error.message
        };
      }
    }
  }
}

export const mpesaService = new MpesaService();