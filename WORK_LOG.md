# Tsuzuri WORK LOG

## 2026-03-01

### LINE ログイン修正・LINE 通知機能準備

**変更ファイル:**
- mobile/App.js: useProxy → WebBrowser.openAuthSessionAsync + Linking ディープリンク方式に変更
- mobile/eas.json: production env に EXPO_PUBLIC_ANTHROPIC_API_KEY 追加
- backend/lambda/auth/index.ts: /auth/line/callback エンドポイント追加、httpsPost 関数追加
- backend/deploy.ps1: ステップ4（auth env vars 更新）追加

**インフラ変更:**
- LINE コンソール コールバック URL を Lambda URL に変更
- Lambda tsuzuri-prod-auth に LINE_LOGIN_CHANNEL_SECRET 環境変数追加
- 綴り LINE 公式アカウント作成（@983bolpv）

**ビルド:**
- Build 16: LINE ログイン修正版（TestFlight 配信済み）
- Build 17: Claude API キー追加版（eas build 実行中）

**確認済み:**
- LINE ログイン ✅
- Face ID ✅
- チャット・AI返答 ❌（Build 17 待ち）

## 2026-02-28

### AI記憶機能実装セッション

**変更内容**
- GET /profile エンドポイント追加（aiProfile + 直近3日の日記テキストを返す）
- 日記保存後（POST/PUT）にプロフィール抽出を fire-and-forget で実行
- extractAndUpdateProfile: Claude Haiku で occupation/family/hobbies/personality/topics を JSON 抽出・更新
- App.js ChatScreen: プロフィール取得 useEffect 追加、buildSystemPrompt を拡張（長期記憶 + 短期記憶セクション）

**変更ファイル**
- backend/lambda/diary/index.ts
- mobile/App.js

---

### UI改善セッション

**変更内容**
- チャット画面バブル角丸修正（LINEライク）
- HomeScreen簡素化（「最近の記録」セクション削除、縦中央配置）
- RecordListScreen：カレンダーグリッド廃止 → 月別アコーディオンに全面刷新
- RecordListScreen：週カレンダー追加（‹ › で週移動、ドット表示、日付タップ選択）
- プレビュー画面「話し直す」→「続きを話す」「最初から話す」に分割
- プレビュー本文タップで直接編集モード
- HomeScreen：今日の記録あり/なしで表示切り替え（白カード統一）
- SYSTEM_PROMPT修正：「いいえ」で日記生成を断れる・会話継続できる
- canGenerate時の視線誘導：右上ボタンをパルスアニメーション＋塗りつぶし表示に変更
- canGenerate時のインジケーター：茶色背景＋「右上のボタンから…」メッセージに変更
- AI質問回数設定：設定画面でステッパー（1〜5回）、SecureStoreで永続化

**変更ファイル**
- mobile/App.js

**確立したルール**
- UIデザイン変更は必ずReactアーティファクトで確認してからApp.jsに反映

---

### 2026-02-28 記憶機能・バグ修正セッション

**変更内容**
- 落款二重バグ修正：追記保存時に既存テキスト末尾の落款を正規表現で除去
- 週カレンダーのスワイプ対応：PanResponder追加（左右スワイプで週移動）
- 落款設定UIの刷新：締め言葉3択ボタン（かしこ/草々/なし）＋名前入力フィールド
- AI記憶機能実装（段階1+2併用）：GET /profile追加、プロフィール抽出、システムプロンプト注入
- callClaudeにAPIエラーチェック追加（data.type === 'error'でthrow）
- テストデータをペルソナ反映内容に変更（既存全削除＋3日分投入）
- バックエンドビルド＆デプロイ完了

**変更ファイル**
- mobile/App.js
- backend/lambda/diary/index.ts
- HANDOVER_20260228_2359.md（引継ぎ書）

---

### EASビルド（TestFlight）

- AI記憶機能実装後の初TestFlightビルド
- `eas build --platform ios --profile preview` 実行
- ビルドURL: https://expo.dev/accounts/mmsystems/builds/

---

### 2026-03-05 App Store審査対応（Guideline 5.1.1(v)）

**背景**
- Appleから却下：アカウント削除機能がないため

**変更内容**
- backend/lambda/auth/index.ts：DELETE /auth/account エンドポイント追加（DynamoDB全件削除、BatchWriteItem、ページネーション対応）
- IAMロール tsuzuri-prod-lambda-role に dynamodb:BatchWriteItem 権限追加
- mobile/App.js：設定画面にアカウント削除ボタン追加（確認ダイアログ→削除→ログアウト）
- mobile/App.js：設定画面の落款名プレースホルダーを「光晴、まんだい　など」→「名前やニックネーム」に修正

**テスト結果**
- バックエンド全4テスト PASS（Claude Codeで実施）
- フロントエンド テスト5〜8 PASS（実機確認）

**デプロイ**
- バックエンド deploy.ps1 完了
- EASビルド production（Build 28）完了
- App Store Connect アップロード済み → 再審査待ち
