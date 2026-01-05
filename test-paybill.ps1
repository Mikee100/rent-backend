# Test Paybill Payment Endpoint
# Replace "101" with an actual house number from your system

$body = @{
    accountNumber = "101"
    amount = 1200
    transactionId = "TEST-$(Get-Date -Format 'yyyyMMddHHmmss')"
    phoneNumber = "254712345678"
    paymentMethod = "mobile_money"
} | ConvertTo-Json

$headers = @{
    "Content-Type" = "application/json"
}

Write-Host "Testing paybill payment endpoint..." -ForegroundColor Cyan
Write-Host "House Number: 101" -ForegroundColor Yellow
Write-Host "Amount: 1200" -ForegroundColor Yellow
Write-Host ""

try {
    $response = Invoke-RestMethod -Uri "http://localhost:7000/api/payments/paybill" `
        -Method POST `
        -Headers $headers `
        -Body $body
    
    Write-Host "✅ Success!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Response:" -ForegroundColor Cyan
    $response | ConvertTo-Json -Depth 10
} catch {
    Write-Host "❌ Error:" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    if ($_.ErrorDetails.Message) {
        Write-Host $_.ErrorDetails.Message -ForegroundColor Red
    }
}

