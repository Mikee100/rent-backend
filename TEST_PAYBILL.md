# Testing M-Pesa Paybill Payments

## Sandbox Paybill Number
**Paybill Number**: `174379` (Safaricom sandbox test number)

## Test Methods

### Method 1: Test Paybill Endpoint Directly (Recommended for Testing)

Use curl or Postman to simulate a paybill payment:

```bash
curl -X POST http://localhost:7000/api/payments/paybill \
  -H "Content-Type: application/json" \
  -d '{
    "accountNumber": "101",
    "amount": 1200,
    "transactionId": "TEST-TXN-001",
    "phoneNumber": "254712345678",
    "paymentMethod": "mobile_money"
  }'
```

**Required fields:**
- `accountNumber` - The house number (e.g., "101", "201", "301")
- `amount` - Payment amount

**Optional fields:**
- `transactionId` - Unique transaction ID
- `phoneNumber` - Payer's phone number
- `paymentMethod` - Defaults to 'mobile_money'
- `paybillNumber` - Will validate against configured paybill if set

### Method 2: Simulate M-Pesa C2B Confirmation

Simulate what M-Pesa sends when a payment is received:

```bash
curl -X POST http://localhost:7000/api/payments/mpesa-confirmation \
  -H "Content-Type: application/json" \
  -d '{
    "TransactionType": "Pay Bill",
    "TransID": "TEST123456789",
    "TransTime": "20240101120000",
    "TransAmount": "1200.00",
    "BusinessShortCode": "174379",
    "BillRefNumber": "101",
    "InvoiceNumber": "",
    "OrgAccountBalance": "50000.00",
    "ThirdPartyTransID": "",
    "MSISDN": "254712345678",
    "FirstName": "John",
    "MiddleName": "",
    "LastName": "Doe"
  }'
```

**Key fields:**
- `BillRefNumber` - This is the house number (account number)
- `TransAmount` - Payment amount
- `TransID` - Transaction ID from M-Pesa
- `MSISDN` - Phone number (format: 254712345678)

### Method 3: Test from Frontend

1. Go to Payments page
2. Click "💰 Receive Payment" button
3. Enter house number (e.g., "101")
4. Click "Search"
5. Fill in payment details
6. Click "Record Payment"

## Testing Checklist

- [ ] Test with valid house number that has a tenant
- [ ] Test with invalid house number (should return error)
- [ ] Test with house that has no tenant (should return error)
- [ ] Test duplicate payment (same transaction ID)
- [ ] Verify payment appears in Payments list
- [ ] Verify payment is linked to correct tenant and house

## Expected Results

**Success Response:**
```json
{
  "message": "Paybill payment received and recorded successfully",
  "payment": { ... },
  "receiptNumber": "RCP-2024-000123",
  "tenant": {
    "name": "John Doe",
    "phone": "+254712345678",
    "email": "john@example.com"
  },
  "house": {
    "number": "101",
    "apartment": "Sunset Apartments"
  }
}
```

**Error Responses:**
- House not found: `404` with message
- No tenant: `400` with message
- Duplicate payment: `400` with existing receipt number

## Notes

- In sandbox mode, you cannot send real M-Pesa payments
- Use the test endpoints to simulate payments
- For production, configure C2B confirmation URL in Safaricom Developer Portal
- The paybill number `174379` is for sandbox testing only

