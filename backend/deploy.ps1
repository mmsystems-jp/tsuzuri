# deploy.ps1 - Tsuzuri Backend Deploy

Write-Host "=== Tsuzuri Deploy ===" -ForegroundColor Cyan

$profile = "mmsystems"
$LINE_CHANNEL_SECRET = "e79ea0ffe3244d8344124c2aa5b3ba3a"
$LINE_MESSAGING_TOKEN = "wiIlu4y7s7Q9wHyqZRXRLp+/ldqEXvjFKfPq4klLU4ZpZHuxvYMvNIMWgZw30bl+4xTkZ/pXtroYLZyXuupHX9HBzkfgbzywTstgHR5ouBhBt8ZOfuKXjQgB7hP6jWVlG53bA1DYPY9xotzTgPPUvQdB04t89/1o/w1cDnyilFU="

# 1. Build
Write-Host "1. Build..." -ForegroundColor Yellow
npm run build
if ($LASTEXITCODE -ne 0) { Write-Host "Build failed" -ForegroundColor Red; exit 1 }

# 2. Create ZIP
Write-Host "2. Create ZIP..." -ForegroundColor Yellow
$lambdas = @("auth", "diary", "stripe", "notify")
foreach ($l in $lambdas) {
    if (Test-Path "lambda-$l.zip") { Remove-Item "lambda-$l.zip" }
    Compress-Archive -Path "dist/$l/*" -DestinationPath "lambda-$l.zip"
    Write-Host "  lambda-$l.zip created" -ForegroundColor Green
}

# 3. Update Lambda code
Write-Host "3. Update Lambda code..." -ForegroundColor Yellow
foreach ($l in $lambdas) {
    aws lambda update-function-code --function-name "tsuzuri-prod-$l" --zip-file "fileb://lambda-$l.zip" --profile $profile 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  tsuzuri-prod-$l updated" -ForegroundColor Green
    } else {
        Write-Host "  tsuzuri-prod-$l failed (may not exist yet)" -ForegroundColor Yellow
    }
}

# 4. auth env vars
Write-Host "4. Update auth env vars..." -ForegroundColor Yellow
$f1 = "env_auth.json"
$c1 = '{"Variables":{"LINE_LOGIN_CHANNEL_ID":"2009194648","TABLE_NAME":"tsuzuri-prod-main","FROM_EMAIL":"noreply@tsuzuri.app","FRONTEND_URL":"https://tsuzuri.app","LINE_LOGIN_CHANNEL_SECRET":"' + $LINE_CHANNEL_SECRET + '"}}'
[System.IO.File]::WriteAllText("$PWD\$f1", $c1, (New-Object System.Text.UTF8Encoding $false))
aws lambda update-function-configuration --function-name "tsuzuri-prod-auth" --environment "file://$f1" --profile $profile | Out-Null
if ($LASTEXITCODE -eq 0) { Write-Host "  auth env updated" -ForegroundColor Green } else { Write-Host "  auth env failed" -ForegroundColor Red }
Remove-Item $f1 -ErrorAction SilentlyContinue

# 5. notify Lambda create or update
Write-Host "5. Setup notify Lambda..." -ForegroundColor Yellow
$f2 = "env_notify.json"
$c2 = '{"Variables":{"TABLE_NAME":"tsuzuri-prod-main","LINE_MESSAGING_CHANNEL_ACCESS_TOKEN":"' + $LINE_MESSAGING_TOKEN + '"}}'
[System.IO.File]::WriteAllText("$PWD\$f2", $c2, (New-Object System.Text.UTF8Encoding $false))

aws lambda get-function --function-name "tsuzuri-prod-notify" --profile $profile 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    $roleArn = aws lambda get-function-configuration --function-name "tsuzuri-prod-auth" --profile $profile --query "Role" --output text
    aws lambda create-function --function-name "tsuzuri-prod-notify" --runtime "nodejs20.x" --role $roleArn --handler "index.handler" --zip-file "fileb://lambda-notify.zip" --timeout 300 --memory-size 256 --environment "file://$f2" --profile $profile | Out-Null
    Write-Host "  tsuzuri-prod-notify created" -ForegroundColor Green
} else {
    aws lambda update-function-configuration --function-name "tsuzuri-prod-notify" --environment "file://$f2" --profile $profile | Out-Null
    Write-Host "  notify env updated" -ForegroundColor Green
}
Remove-Item $f2 -ErrorAction SilentlyContinue

# 6. EventBridge rule (21:00 JST = 12:00 UTC)
Write-Host "6. Setup EventBridge rule..." -ForegroundColor Yellow
$ruleName = "tsuzuri-daily-notify"
aws events describe-rule --name $ruleName --profile $profile 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    $scheduleExpr = 'cron(0 12 * * ? *)'
    aws events put-rule --name $ruleName --schedule-expression $scheduleExpr --state ENABLED --profile $profile | Out-Null
    $lambdaArn = aws lambda get-function-configuration --function-name "tsuzuri-prod-notify" --profile $profile --query "FunctionArn" --output text
    $f3 = "targets.json"
    $c3 = '[{"Id":"1","Arn":"' + $lambdaArn + '"}]'
    [System.IO.File]::WriteAllText("$PWD\$f3", $c3, (New-Object System.Text.UTF8Encoding $false))
    aws events put-targets --rule $ruleName --targets "file://$f3" --profile $profile | Out-Null
    Remove-Item $f3 -ErrorAction SilentlyContinue
    $ruleArn = aws events describe-rule --name $ruleName --profile $profile --query "Arn" --output text
    aws lambda add-permission --function-name "tsuzuri-prod-notify" --statement-id "EventBridgeInvoke" --action "lambda:InvokeFunction" --principal "events.amazonaws.com" --source-arn $ruleArn --profile $profile | Out-Null
    Write-Host "  EventBridge rule created" -ForegroundColor Green
} else {
    Write-Host "  EventBridge rule already exists" -ForegroundColor Green
}

Write-Host "=== Deploy Done ===" -ForegroundColor Cyan
