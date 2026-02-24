# deploy.ps1 - Tsuzuri Backend Deploy

Write-Host "=== Tsuzuri Deploy ===" -ForegroundColor Cyan

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
$profile = "mmsystems"
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

Write-Host "=== Deploy Done ===" -ForegroundColor Cyan
