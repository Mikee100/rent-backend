# M-Pesa Integration Setup Guide

## Quick Setup

Add these variables to your `backend/.env` file:

```env
# M-Pesa Configuration
MPESA_ENV=sandbox
MPESA_CONSUMER_KEY=your_consumer_key_here
MPESA_CONSUMER_SECRET=your_consumer_secret_here
MPESA_SHORTCODE=174379
MPESA_PASSKEY=your_passkey_here
MPESA_CALLBACK_URL=http://localhost:7000/api/mpesa/callback
```

## Getting M-Pesa Credentials

### Step 1: Register at Safaricom Developer Portal
1. Go to [https://developer.safaricom.co.ke/](https://developer.safaricom.co.ke/)
2. Click "Get Started" or "Sign Up"
3. Create an account (free)

### Step 2: Create an App
1. Log in to the developer portal
2. Go to "My Apps" section
3. Click "Create App" or use an existing app
4. Fill in the app details:
   - **App Name**: Rent Management System (or any name)
   - **Description**: Payment integration for rent collection
5. Save the app

### Step 3: Get Your Credentials
After creating the app, you'll see:
- **Consumer Key** - Copy this to `MPESA_CONSUMER_KEY`
- **Consumer Secret** - Copy this to `MPESA_CONSUMER_SECRET`

### Step 4: Get Shortcode and Passkey

#### For Sandbox (Testing):
- **Shortcode**: Use `174379` (Safaricom test shortcode)
- **Passkey**: 
  1. Go to "Sandbox" section in the developer portal
  2. Find "Lipa na M-Pesa Online" section
  3. Click "Generate Test Passkey"
  4. Copy the generated passkey to `MPESA_PASSKEY`

#### For Production:
- **Shortcode**: Your registered Paybill or Till number from Safaricom
- **Passkey**: 
  1. Contact Safaricom to register for Lipa na M-Pesa Online
  2. They will provide your passkey
  3. Copy it to `MPESA_PASSKEY`

### Step 5: Set Callback URL

#### For Local Development:
1. Install [ngrok](https://ngrok.com/): `npm install -g ngrok` or download from ngrok.com
2. Start your server: `npm run dev`
3. In another terminal, run: `ngrok http 7000`
4. Copy the HTTPS URL (e.g., `https://abc123.ngrok.io`)
5. Set in `.env`:
   ```env
   MPESA_CALLBACK_URL=https://abc123.ngrok.io/api/mpesa/callback
   ```
6. Update the callback URL in Safaricom Developer Portal:
   - Go to your app settings
   - Set **Confirmation URL**: `https://abc123.ngrok.io/api/mpesa/callback`
   - Set **Validation URL** (optional): `https://abc123.ngrok.io/api/mpesa/validation`

#### For Production:
```env
MPESA_CALLBACK_URL=https://your-domain.com/api/mpesa/callback
```

Then update in Safaricom Developer Portal:
- **Confirmation URL**: `https://your-domain.com/api/mpesa/callback`
- **Validation URL**: `https://your-domain.com/api/mpesa/validation`

## Environment Variables Reference

| Variable | Description | Example | Required |
|----------|-------------|---------|----------|
| `MPESA_ENV` | Environment: `sandbox` or `production` | `sandbox` | Yes |
| `MPESA_CONSUMER_KEY` | Your app's consumer key | `abc123...` | Yes |
| `MPESA_CONSUMER_SECRET` | Your app's consumer secret | `xyz789...` | Yes |
| `MPESA_SHORTCODE` | Paybill/Till number | `174379` (sandbox) | Yes |
| `MPESA_PASSKEY` | Generated passkey | `abc123...` | Yes |
| `MPESA_CALLBACK_URL` | Where M-Pesa sends confirmations | `https://...` | Yes |

## Testing

### Test Phone Numbers (Sandbox Only)
- Use: `254708374149` for testing
- Any amount can be used in sandbox mode

### Test the Integration
1. Make sure all environment variables are set
2. Restart your server: `npm run dev`
3. You should see: `✅ M-Pesa configuration found`
4. Try initiating an STK Push payment from the UI

## Troubleshooting

### Error: "Missing M-Pesa configuration"
- Check that all required variables are in `backend/.env`
- Make sure there are no typos in variable names
- Restart the server after adding variables

### Error: "M-Pesa authentication failed: Invalid credentials"
- Verify your Consumer Key and Secret are correct
- Make sure you copied them without extra spaces
- Check that `MPESA_ENV` is set correctly (`sandbox` or `production`)

### Error: "Failed to initiate M-Pesa payment"
- Check your internet connection
- Verify the callback URL is accessible (use ngrok for local)
- Check that the shortcode and passkey match your environment

### Callback Not Working
- Make sure ngrok is running (for local development)
- Verify the callback URL in Safaricom portal matches your `.env`
- Check server logs for callback errors

## Security Notes

⚠️ **Never commit your `.env` file to version control!**

- The `.env` file should be in `.gitignore`
- Use different credentials for development and production
- Keep your Consumer Secret secure
- Rotate credentials if compromised

## Next Steps

Once configured:
1. Test with sandbox credentials first
2. Verify payments appear in the system
3. When ready for production, contact Safaricom to:
   - Register your Paybill/Till number
   - Get production credentials
   - Update environment variables
   - Change `MPESA_ENV=production`

## Support

- Safaricom Developer Portal: [https://developer.safaricom.co.ke/](https://developer.safaricom.co.ke/)
- M-Pesa API Documentation: Available in the developer portal
- For issues with this integration, check server logs for detailed error messages

