import { DynamoDBClient, GetItemCommand, PutItemCommand, QueryCommand, UpdateItemCommand, DeleteItemCommand } from '@aws-sdk/client-dynamodb';

export const dynamo = new DynamoDBClient({});
export const TABLE = process.env.TABLE_NAME || 'tsuzuri-prod-main';

export const cors = {
  'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
};

export const ok = (body: unknown, status = 200) => ({
  statusCode: status,
  headers: cors,
  body: JSON.stringify(body),
});

export const err = (message: string, status = 400) => ({
  statusCode: status,
  headers: cors,
  body: JSON.stringify({ error: message }),
});

// セッショントークン検証
// token形式: tsz_{userId}_{random}
export async function verifySession(token: string): Promise<string | null> {
  if (!token) return null;
  const t = token.replace('Bearer ', '');

  const parts = t.split('_');
  if (parts.length < 3 || parts[0] !== 'tsz') return null;
  const userId = parts[1];

  try {
    const res = await dynamo.send(new GetItemCommand({
      TableName: TABLE,
      Key: {
        PK: { S: `USER#${userId}` },
        SK: { S: `SESSION#${t}` },
      },
    }));
    if (!res.Item) return null;

    const expiresAt = Number(res.Item.expiresAt?.N || 0);
    if (Date.now() / 1000 > expiresAt) return null;

    return userId;
  } catch {
    return null;
  }
}

// 乱数ID生成
export function newId(prefix = ''): string {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// 今日の日付（JST）
export function todayJST(): string {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}
