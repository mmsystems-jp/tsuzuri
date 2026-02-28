# Tsuzuri WORK LOG

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
