# 綴り（Tsuzuri）引継ぎ書
# 作成日: 2026-02-18

## プロダクト概要
- **名前**: 綴り（Tsuzuri）
- **コンセプト**: AIと会話するだけで日記が完成するSaaSアプリ
- **価格**: 月額500円（Stripe）
- **ターゲット**: 日記が続かない日本人（将来的に英語対応も視野）

---

## 現在の状態

### UI（完成済み）
- **ファイル**: `C:\mmsystems\projects\tsuzuri\frontend\` に `App.jsx` は未配置
  - Claude Artifactsで動作確認済みの完成版: `/mnt/user-data/outputs/tsuzuri-v1.jsx`
  - 全画面実装済み: オンボーディング・ホーム・チャット・プレビュー・編集・カレンダー・統計・設定・詳細
  - テーマ4種: ライト・ダーク・セピア・ナイト
  - Claude API直接呼び出し（会話→日記自動生成）
  - スターターボタン（良い一日だった等）→ 続けて書く機能

### バックエンド（設計済み・未デプロイ）
- **リポジトリ**: `https://github.com/mmsystems-jp/tsuzuri`（Public）
- **ローカル**: `C:\mmsystems\projects\tsuzuri\`
- **構成**:
  ```
  tsuzuri/
  ├── backend/
  │   ├── lambda/auth/index.ts    # OTPメール認証
  │   ├── lambda/diary/index.ts   # 日記CRUD
  │   ├── lambda/stripe/index.ts  # 決済
  │   ├── shared/utils.ts         # 共通ユーティリティ
  │   ├── package.json
  │   ├── tsconfig.json
  │   ├── deploy.ps1
  │   └── .env.example
  ├── infra/main.tf               # Terraform（DynamoDB・Lambda・API GW）
  ├── TABLE_DESIGN.md
  └── README.md
  ```

### AWS設定
- **プロファイル**: mmsystems
- **リージョン**: ap-northeast-1
- **テーブル名（予定）**: tsuzuri-prod-main

---

## 次にやること（優先順）

### 1. Terraformでインフラ構築
```powershell
cd C:\mmsystems\projects\tsuzuri\infra
terraform init
# prod.tfvarsを作成してから↓
terraform apply -var-file="prod.tfvars"
```
`prod.tfvars` に必要な変数:
```hcl
from_email            = "noreply@tsuzuri.app"
frontend_url          = "https://tsuzuri.app"  # 仮
stripe_secret_key     = "sk_live_xxx"
stripe_price_id       = "price_xxx"
stripe_webhook_secret = "whsec_xxx"
```

### 2. SESメール認証
```powershell
aws ses verify-email-identity --email-address noreply@tsuzuri.app --profile mmsystems
```

### 3. バックエンドビルド＆デプロイ
```powershell
cd C:\mmsystems\projects\tsuzuri\backend
npm install
cp .env.example .env  # .envを編集
.\deploy.ps1
```

### 4. Stripe設定
- Stripeダッシュボードで月額500円のProductとPrice作成
- Webhookエンドポイント登録

### 5. フロントエンドAPI接続
- ログイン画面追加（メールアドレス入力→OTP入力）
- 各画面でAPIフェッチに差し替え（モックデータ→実データ）

---

## 設計の重要な判断事項

| 項目 | 決定内容 | 理由 |
|------|---------|------|
| 認証 | メールOTP（Cognito不使用） | GenbaKintaiで実績あり、シンプル |
| DB | DynamoDBシングルテーブル | コスト・スケール |
| セッション | tokenにuserIdを埋め込む（tsz_{userId}_{random}） | GSIなしで検証可能 |
| フロント | React PWA（Vite予定） | 既存スキル活用 |

---

## コスト見積もり（月100ユーザー時）
- DynamoDB: ~$1
- Lambda + API GW: 無料枠内〜$2
- SES: ~$0.1
- **合計: ~$2〜3**
- 売上（100人×500円）: 50,000円 → **利益率95%以上**

---

## 参考リンク
- GitHub: https://github.com/mmsystems-jp/tsuzuri
- TABLE_DESIGN: `C:\mmsystems\projects\tsuzuri\TABLE_DESIGN.md`
- README: `C:\mmsystems\projects\tsuzuri\README.md`
