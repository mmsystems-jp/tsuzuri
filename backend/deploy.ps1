# deploy.ps1 - 綴り バックエンドデプロイ
# 使い方: cd backend && .\deploy.ps1

Write-Host "=== 綴り デプロイ ===" -ForegroundColor Cyan

# 1. ビルド
Write-Host "1. TypeScript ビルド..." -ForegroundColor Yellow
npm run build
if ($LASTEXITCODE -ne 0) { Write-Host "ビルド失敗" -ForegroundColor Red; exit 1 }

# 2. ZIP作成
Write-Host "2. ZIP作成..." -ForegroundColor Yellow
$lambdas = @("auth", "diary", "stripe")
foreach ($l in $lambdas) {
    $src = "dist/lambda/$l"
    $dst = "lambda-$l.zip"
    if (Test-Path $dst) { Remove-Item $dst }
    # sharedをコピー
    Copy-Item "dist/shared" "$src/shared" -Recurse -Force -ErrorAction SilentlyContinue
    Compress-Archive -Path "$src/*" -DestinationPath $dst
    Write-Host "  $dst 作成完了" -ForegroundColor Green
}

# 3. Lambda更新
Write-Host "3. Lambda更新..." -ForegroundColor Yellow
$profile = "mmsystems"
foreach ($l in $lambdas) {
    aws lambda update-function-code `
        --function-name "tsuzuri-prod-$l" `
        --zip-file "fileb://lambda-$l.zip" `
        --profile $profile | Out-Null
    Write-Host "  tsuzuri-prod-$l 更新完了" -ForegroundColor Green
}

Write-Host "=== デプロイ完了 ===" -ForegroundColor Cyan
