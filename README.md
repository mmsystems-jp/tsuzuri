# 綴り（Tsuzuri）バックエンド

## アーキテクチャ

```
[React PWA] → [API Gateway] → [Lambda] → [DynamoDB]
                                       → [SES] (OTPメール)
                                       → [Stripe] (決済)
```

## APIエンドポイント

### 認証
| Method | Path | 説明 |
|--------|------|------|
| POST | /auth/send-otp | OTPメール送信 |
| POST | /auth/verify   | OTP検証 → トークン取得 |
| GET  | /auth/me       | ログインユーザー情報 |
| POST | /auth/logout   | ログアウト |

### 日記
| Method | Path | 説明 |
|--------|------|------|
| POST   | /diary            | 日記保存 |
| GET    | /diary?month=YYYY-MM | 一覧取得 |
| GET    | /diary/{date}     | 1件取得 |
| PUT    | /diary/{date}     | 編集 |
| DELETE | /diary/{date}     | 削除 |

### 決済
| Method | Path | 説明 |
|--------|------|------|
| POST | /stripe/checkout | チェックアウトURL取得 |
| POST | /stripe/portal   | 解約・カード変更ポータル |
| POST | /stripe/webhook  | Stripe Webhook（署名検証あり） |

## セットアップ手順

### 1. AWSリソース作成（Terraform）
```powershell
cd infra
terraform init
terraform apply -var-file="prod.tfvars"
```

### 2. SESメール認証
```powershell
aws ses verify-email-identity --email-address noreply@tsuzuri.app --profile mmsystems
```

### 3. バックエンドビルド＆デプロイ
```powershell
cd backend
npm install
cp .env.example .env
# .envを編集して実際の値を記入
.\deploy.ps1
```

### 4. Stripe設定
1. Stripeダッシュボードで月額500円のProductとPriceを作成
2. Price IDを .env の STRIPE_PRICE_ID に設定
3. Webhookエンドポイントを登録: `https://{api_url}/stripe/webhook`
4. Webhook Secretを .env の STRIPE_WEBHOOK_SECRET に設定

## コスト見積もり（月100ユーザー）
| サービス | 月額 |
|---------|------|
| DynamoDB | ~$1 |
| Lambda   | 無料枠内 |
| API GW   | ~$1 |
| SES      | ~$0.1 |
| **合計** | **~$2〜3** |
