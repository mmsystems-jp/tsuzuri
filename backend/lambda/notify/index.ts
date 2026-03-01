/**
 * 綴り 通知 Lambda
 * EventBridge で毎日21:00(JST)に起動
 * 今日まだ日記を書いていないユーザーに LINE Flex Message を送る
 */

import { DynamoDBClient, ScanCommand, GetItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import * as https from 'https';

const dynamo = new DynamoDBClient({});
const TABLE = process.env.TABLE_NAME || 'tsuzuri-prod-main';
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN || '';

// 今日の日付（JST）
function todayJST(): string {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

// 今日の日記を書いているか確認
async function hasDiaryToday(userId: string, today: string): Promise<boolean> {
  try {
    const res = await dynamo.send(new GetItemCommand({
      TableName: TABLE,
      Key: {
        PK: { S: `USER#${userId}` },
        SK: { S: `DIARY#${today}` },
      },
    }));
    return !!res.Item;
  } catch {
    return false;
  }
}

// lineUserId を PROFILE から削除（ブロック・退会時）
async function removeLineUserId(userId: string): Promise<void> {
  try {
    await dynamo.send(new UpdateItemCommand({
      TableName: TABLE,
      Key: { PK: { S: `USER#${userId}` }, SK: { S: 'PROFILE' } },
      UpdateExpression: 'REMOVE lineUserId',
    }));
    console.log(`lineUserId削除: userId=${userId}`);
  } catch (e) {
    console.error(`lineUserId削除失敗: ${e}`);
  }
}

const LIFF_URL = 'https://liff.line.me/2009194648-zubANYib';

// 通知メッセージ生成（Flex Message）
function buildMessage(): object {
  const messages = [
    '今日もお疲れさまでした。\n少しだけ、今日のことを話してみませんか？',
    '今日はどんな一日でしたか？\n綴りがお話を聞いています。',
    '日記を書く習慣が、少しずつあなたを整えていきます。\n今夜も綴りを開いてみてください。',
    '今日の出来事、感じたこと、何でも話しかけてみてください。\n綴りがそっと日記にしてくれます。',
  ];
  const today = todayJST();
  const day = parseInt(today.replace(/-/g, ''), 10);
  const text = messages[day % messages.length];

  return {
    type: 'flex',
    altText: '今日の綴り',
    contents: {
      type: 'bubble',
      size: 'kilo',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [{ type: 'text', text: '今日の綴り', weight: 'bold', size: 'sm', color: '#8B7355' }],
        paddingAll: '16px',
        backgroundColor: '#FDF6EE',
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [{ type: 'text', text, wrap: true, size: 'sm', color: '#4A4A4A', lineSpacing: '6px' }],
        paddingAll: '16px',
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [{
          type: 'button',
          action: { type: 'uri', label: '綴りを開く', uri: LIFF_URL },
          style: 'primary',
          color: '#8B7355',
          height: 'sm',
        }],
        paddingAll: '12px',
        backgroundColor: '#FDF6EE',
      },
    },
  };
}

// LINE Push Message 送信
// 戻り値: 'ok' | 'blocked' | 'error'
async function sendLinePush(lineUserId: string, message: object): Promise<'ok' | 'blocked' | 'error'> {
  const body = JSON.stringify({
    to: lineUserId,
    messages: [message],
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
      let resBody = '';
      res.on('data', (chunk) => { resBody += chunk; });
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve('ok');
        } else if (res.statusCode === 403) {
          // 403 のみブロック確定（友だち削除・退会）→ lineUserId を削除する
          console.warn(`LINE ブロック確定(403) lineUserId=${lineUserId} body=${resBody}`);
          resolve('blocked');
        } else {
          // 400 は Flex Message フォーマットエラーの可能性があるため削除しない
          console.error(`LINE Push失敗 status=${res.statusCode} body=${resBody}`);
          resolve('error');
        }
      });
    });
    req.on('error', (e) => {
      console.error(`request error: ${e.message}`);
      resolve('error');
    });
    req.write(body);
    req.end();
  });
}

export const handler = async (): Promise<void> => {
  console.log('通知Lambda開始');
  const today = todayJST();

  const message = buildMessage();
  let lastKey: Record<string, any> | undefined = undefined;
  let successCount = 0;
  let failCount = 0;
  let skippedCount = 0;
  let blockedCount = 0;

  do {
    const res = await dynamo.send(new ScanCommand({
      TableName: TABLE,
      FilterExpression: 'begins_with(PK, :pk) AND SK = :sk AND attribute_exists(lineUserId) AND (attribute_not_exists(notifyEnabled) OR notifyEnabled = :true)',
      ExpressionAttributeValues: {
        ':pk':   { S: 'USER#' },
        ':sk':   { S: 'PROFILE' },
        ':true': { BOOL: true },
      },
      ExclusiveStartKey: lastKey,
    }));

    const items = res.Items || [];
    console.log(`対象ユーザー数: ${items.length}`);

    for (const item of items) {
      const lineUserId = item.lineUserId?.S;
      const userId = item.PK?.S?.replace('USER#', '');
      if (!lineUserId || !userId) continue;

      // 今日すでに日記を書いていたらスキップ
      const alreadyWrote = await hasDiaryToday(userId, today);
      if (alreadyWrote) {
        skippedCount++;
        continue;
      }

      const result = await sendLinePush(lineUserId, message);
      if (result === 'ok') {
        successCount++;
      } else if (result === 'blocked') {
        blockedCount++;
        await removeLineUserId(userId);
      } else {
        failCount++;
      }
    }

    lastKey = res.LastEvaluatedKey;
  } while (lastKey);

  console.log(`通知完了 success=${successCount} skipped=${skippedCount} blocked=${blockedCount} fail=${failCount}`);
};
