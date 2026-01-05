import axios from 'axios';
import crypto from 'crypto';

const MPESA_BASE_URL = process.env.MPESA_ENV === 'production' 
  ? 'https://api.safaricom.co.ke'
  : 'https://sandbox.safaricom.co.ke';

class MpesaService {
  constructor() {
    this.accessToken = null;
    this.tokenExpiry = null;
  }

  // Get config values dynamically (read from env each time to ensure latest values)
  get consumerKey() {
    return process.env.MPESA_CONSUMER_KEY;
  }

  get consumerSecret() {
    return process.env.MPESA_CONSUMER_SECRET;
  }

  get shortcode() {
    return process.env.MPESA_SHORTCODE;
  }

  get passkey() {
    return process.env.MPESA_PASSKEY;
  }

  get callbackUrl() {
    return process.env.MPESA_CALLBACK_URL;
  }

  // Validate M-Pesa configuration
  validateConfig() {
    const missing = [];
    const values = {
      consumerKey: this.consumerKey,
      consumerSecret: this.consumerSecret,
      shortcode: this.shortcode,
      passkey: this.passkey,
      callbackUrl: this.callbackUrl
    };
    
    // Debug: Log what we're checking (without exposing secrets)
    console.log('M-Pesa Config Check:', {
      consumerKey: values.consumerKey ? `${values.consumerKey.substring(0, 4)}...` : 'MISSING',
      consumerSecret: values.consumerSecret ? 'SET' : 'MISSING',
      shortcode: values.shortcode || 'MISSING',
      passkey: values.passkey ? 'SET' : 'MISSING',
      callbackUrl: values.callbackUrl || 'MISSING'
    });
    
    // Check for undefined, null, or empty string (after trim)
    if (!values.consumerKey || !String(values.consumerKey).trim()) missing.push('MPESA_CONSUMER_KEY');
    if (!values.consumerSecret || !String(values.consumerSecret).trim()) missing.push('MPESA_CONSUMER_SECRET');
    if (!values.shortcode || !String(values.shortcode).trim()) missing.push('MPESA_SHORTCODE');
    if (!values.passkey || !String(values.passkey).trim()) missing.push('MPESA_PASSKEY');
    if (!values.callbackUrl || !String(values.callbackUrl).trim()) missing.push('MPESA_CALLBACK_URL');
    
    if (missing.length > 0) {
      throw new Error(`Missing M-Pesa configuration: ${missing.join(', ')}. Please check your .env file.`);
    }
  }

  // Get OAuth access token
  async getAccessToken() {
    try {
      // Validate configuration first
      this.validateConfig();

      // Check if we have a valid token
      if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
        return this.accessToken;
      }

      if (!this.consumerKey || !this.consumerSecret) {
        throw new Error('M-Pesa Consumer Key and Secret are required. Please configure them in your .env file.');
      }

      const auth = Buffer.from(`${this.consumerKey}:${this.consumerSecret}`).toString('base64');
      
      const response = await axios.get(
        `${MPESA_BASE_URL}/oauth/v1/generate?grant_type=client_credentials`,
        {
          headers: {
            Authorization: `Basic ${auth}`
          }
        }
      );

      if (!response.data || !response.data.access_token) {
        throw new Error('Invalid response from M-Pesa: No access token received');
      }

      this.accessToken = response.data.access_token;
      // Token expires in 3599 seconds, set expiry to 3500 seconds for safety
      this.tokenExpiry = Date.now() + (3500 * 1000);
      
      return this.accessToken;
    } catch (error) {
      if (error.response) {
        const status = error.response.status;
        const data = error.response.data;
        
        if (status === 400) {
          console.error('M-Pesa Authentication Error (400):', {
            message: data?.error_description || data?.error || 'Bad Request',
            hint: 'Check your MPESA_CONSUMER_KEY and MPESA_CONSUMER_SECRET in .env file',
            environment: process.env.MPESA_ENV || 'not set',
            baseUrl: MPESA_BASE_URL
          });
          throw new Error(`M-Pesa authentication failed: ${data?.error_description || data?.error || 'Invalid credentials'}. Please verify your Consumer Key and Secret in the .env file.`);
        } else if (status === 401) {
          throw new Error('M-Pesa authentication failed: Unauthorized. Please check your Consumer Key and Secret.');
        } else {
          console.error('M-Pesa API Error:', {
            status,
            data: data,
            message: error.message
          });
          throw new Error(`M-Pesa API error (${status}): ${data?.error_description || data?.error || error.message}`);
        }
      } else {
        console.error('Error getting M-Pesa access token:', error.message);
        throw error;
      }
    }
  }

  // Generate password for STK Push
  generatePassword() {
    const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, -3);
    const password = Buffer.from(`${this.shortcode}${this.passkey}${timestamp}`).toString('base64');
    return { password, timestamp };
  }

  // Initiate STK Push
  async initiateSTKPush(phoneNumber, amount, accountReference, transactionDesc) {
    try {
      // Validate configuration
      this.validateConfig();
      
      const accessToken = await this.getAccessToken();
      const { password, timestamp } = this.generatePassword();

      // Format phone number (remove + and ensure it starts with 254)
      let formattedPhone = phoneNumber.replace(/\s+/g, '').replace(/^\+/, '');
      if (!formattedPhone.startsWith('254')) {
        if (formattedPhone.startsWith('0')) {
          formattedPhone = '254' + formattedPhone.substring(1);
        } else {
          formattedPhone = '254' + formattedPhone;
        }
      }

      const requestBody = {
        BusinessShortCode: this.shortcode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: 'CustomerPayBillOnline',
        Amount: Math.round(amount), // M-Pesa requires integer
        PartyA: formattedPhone,
        PartyB: this.shortcode,
        PhoneNumber: formattedPhone,
        CallBackURL: this.callbackUrl,
        AccountReference: accountReference, // House number
        TransactionDesc: transactionDesc || `Rent payment for house ${accountReference}`
      };

      const response = await axios.post(
        `${MPESA_BASE_URL}/mpesa/stkpush/v1/processrequest`,
        requestBody,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      return {
        success: true,
        checkoutRequestID: response.data.CheckoutRequestID,
        customerMessage: response.data.CustomerMessage,
        responseCode: response.data.ResponseCode,
        responseDescription: response.data.ResponseDescription,
        merchantRequestID: response.data.MerchantRequestID
      };
    } catch (error) {
      console.error('Error initiating STK Push:', error.response?.data || error.message);
      throw new Error(error.response?.data?.errorMessage || 'Failed to initiate M-Pesa payment');
    }
  }

  // Query STK Push status
  async querySTKPushStatus(checkoutRequestID) {
    try {
      const accessToken = await this.getAccessToken();
      const { password, timestamp } = this.generatePassword();

      const requestBody = {
        BusinessShortCode: this.shortcode,
        Password: password,
        Timestamp: timestamp,
        CheckoutRequestID: checkoutRequestID
      };

      const response = await axios.post(
        `${MPESA_BASE_URL}/mpesa/stkpushquery/v1/query`,
        requestBody,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      return response.data;
    } catch (error) {
      console.error('Error querying STK Push status:', error.response?.data || error.message);
      throw new Error('Failed to query M-Pesa payment status');
    }
  }
}

export default new MpesaService();

