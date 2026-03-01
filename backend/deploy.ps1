# deploy.ps1 - Tsuzuri Backend Deploy

Write-Host "=== Tsuzuri Deploy ===" -ForegroundColor Cyan

$profile = "mmsystems"
$LINE_CHANNEL_SECRET = "e79ea0ffe3244d8344124c2aa5b3ba3a"

# 1. Build
Write-Host "1. Build..." -ForegroundColor Yellow
npm run build
if ($LASTEXITCODE -ne 0) { Write-Host "Build failed" -ForegroundColor Red; exit 1 }

# 2. Create ZIP
Write-Host "2. Create ZIP..." -ForegroundColor Yellow
$lambdas = @("auth", "diary", "stripe")
foreach ($l in $lambdas) {
    $src = "dist/$l"
    $dst = "lambda-$l.zip"
    if (Test-Path $dst) { Remove-Item $dst }
    Compress-Archive -Path "$src/*" -DestinationPath $dst
    Write-Host "  $dst created" -ForegroundColor Green
}

# 3. Update Lambda
Write-Host "3. Update Lambda..." -ForegroundColor Yellow
foreach ($l in $lambdas) {
    $result = aws lambda update-function-code `
        --function-name "tsuzuri-prod-$l" `
        --zip-file "fileb://lambda-$l.zip" `
        --profile $profile 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  tsuzuri-prod-$l updated" -ForegroundColor Green
    } else {
        Write-Host "  tsuzuri-prod-$l failed: $result" -ForegroundColor Red
    }
}

# 4. auth Lambda の環境変数に LINE_LOGIN_CHANNEL_SECRET を追加
Write-Host "4. Update auth env vars..." -ForegroundColor Yellow
$envFile = "env_update.json"
$envContent = @"
{
  "Variables": {
    "LINE_LOGIN_CHANNEL_ID": "2009194648",
    "TABLE_NAME": "tsuzuri-prod-main",
    "FROM_EMAIL": "noreply@tsuzuri.app",
    "FRONTEND_URL": "https://tsuzuri.app",
    "LINE_LOGIN_CHANNEL_SECRET": "$LINE_CHANNEL_SECRET"
  }
}
"@
[System.IO.File]::WriteAllText("$PWD\$envFile", $envContent, (New-Object System.Text.UTF8Encoding $false))

aws lambda update-function-configuration `
    --function-name "tsuzuri-prod-auth" `
    --environment "file://$envFile" `
    --profile $profile | Out-Null

if ($LASTEXITCODE -eq 0) {
    Write-Host "  auth env updated" -ForegroundColor Green
} else {
    Write-Host "  auth env update failed" -ForegroundColor Red
}
Remove-Item $envFile -ErrorAction SilentlyContinue

Write-Host "=== Deploy Done ===" -ForegroundColor Cyan
