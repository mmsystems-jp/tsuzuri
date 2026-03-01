/**
 * 綴り 通知 Lambda
 * EventBridge で毎日21:00(JST)に起動
 * DynamoDB から lineUserId を持つ全ユーザーに LINE Push 通知を送る
 */

import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';
import * as https from 'https';

const dynamo = new DynamoDBClient({});
const TABLE = process.env.TABLE_NAME || 'tsuzuri-prod-main';
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN || '';

// LINE Push Message 送信
async function sendLinePush(lineUserId: string, message: string): Promise<boolean> {
  const body = JSON.stringify({
    to: lineUserId,
    messages: [{ type: 'text', text: message }],
  });

  return new Promise((resolve) => {
    const options = {
      hostname: 'api.line.me',
      path: '/v2/bot/message/push',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.write(body);
    req.end();
  });
}

// 今日の日付（JST）
function todayJST(): string {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

// 通知メッセージ生成
function buildMessage(): string {
  const today = todayJST();
  const messages = [
    `今日もお疲れさまでした。\n少しだけ、今日のことを綴りに話しかけてみませんか？`,
    `今日はどんな一日でしたか？\n綴りがお話を聞いています。`,
    `日記を書く習慣が、少しずつあなたを整えていきます。\n今夜も綴りを開いてみてください。`,
    `今日の出来事、感じたこと、何でも話しかけてみてください。\n綴りがそっと日記にしてくれます。`,
  ];
  // 日付から安定したインデックスを選ぶ（毎日同じにならないように）
  const day = parseInt(today.replace(/-/g, ''), 10);
  return messages[day % messages.length];
}

export const handler = async (): Promise<void> => {
  console.log('通知Lambda開始');

  // DynamoDB から lineUserId を持つユーザーを全件スキャン
  // USER#xxx の PK を持ち、SK が PROFILE のアイテムを対象にする
  let lastKey: Record<string, any> | undefined = undefined;
  let successCount = 0;
  let failCount = 0;
  const message = buildMessage();

  do {
    const res = await dynamo.send(new ScanCommand({
      TableName: TABLE,
      FilterExpression: 'begins_with(PK, :pk) AND SK = :sk AND attribute_exists(lineUserId)',
      ExpressionAttributeValues: {
        ':pk': { S: 'USER#' },
        ':sk': { S: 'PROFILE' },
      },
      ExclusiveStartKey: lastKey,
    }));

    const items = res.Items || [];
    console.log(`取得ユーザー数: ${items.length}`);

    for (const item of items) {
      const lineUserId = item.lineUserId?.S;
      if (!lineUserId) continue;

      const ok = await sendLinePush(lineUserId, message);
      if (ok) {
        successCount++;
      } else {
        failCount++;
        console.warn(`送信失敗: lineUserId=${lineUserId}`);
      }
    }

    lastKey = res.LastEvaluatedKey;
  } while (lastKey);

  console.log(`通知完了 success=${successCount} fail=${failCount}`);
};
