# 綴り DynamoDB テーブル設計

## テーブル名: tsuzuri-prod-main

### シングルテーブル設計

| PK | SK | 用途 |
|----|-----|------|
| USER#{userId} | PROFILE | ユーザープロフィール |
| OTP#{email} | OTP | ワンタイムコード（TTL付き） |
| USER#{userId} | SESSION#{token} | セッショントークン（TTL付き） |
| USER#{userId} | DIARY#{YYYY-MM-DD} | 日記エントリ |

### GSI
- email-index: email → PK（ユーザー検索用）

### 主要アイテム詳細

#### PROFILE
```
PK: USER#{userId}
SK: PROFILE
email: string
createdAt: ISO8601
plan: "free" | "premium"
stripeCustomerId?: string
theme: "light" | "dark" | "sepia" | "night"
notifyEnabled: boolean
notifyHour: number       // 21 = 21時
streak: number
totalEntries: number
totalChars: number
lastEntryDate: string
```

#### DIARY#{YYYY-MM-DD}
```
PK: USER#{userId}
SK: DIARY#2025-02-18
date: "2025-02-18"
text: string             // AI生成日記本文
conversation: string     // 会話履歴（JSON文字列）
moodIdx: number          // 0-4 気分カラーインデックス
charCount: number
createdAt: ISO8601
updatedAt: ISO8601
```

#### SESSION#{token}
```
PK: USER#{userId}
SK: SESSION#{token}
token: string
expiresAt: number        // TTL (Unix timestamp, 30日)
createdAt: ISO8601
```

#### OTP#{email}
```
PK: OTP#{email}
SK: OTP
code: string             // 6桁
email: string
expiresAt: number        // TTL (10分)
attempts: number         // 最大5回
```
