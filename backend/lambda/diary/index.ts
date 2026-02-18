/**
 * 綴り 日記 Lambda
 * POST   /diary          → 日記保存（新規 or 上書き）
 * GET    /diary          → 一覧取得（月指定）
 * GET    /diary/{date}   → 1件取得
 * PUT    /diary/{date}   → 編集
 * DELETE /diary/{date}   → 削除
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient, PutItemCommand, GetItemCommand, QueryCommand, UpdateItemCommand, DeleteItemCommand } from '@aws-sdk/client-dynamodb';
import { dynamo, TABLE, ok, err, verifySession, todayJST } from '../../shared/utils';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  if (event.httpMethod === 'OPTIONS') return ok({});

  const token = event.headers.Authorization || event.headers.authorization || '';
  const userId = await verifySession(token);
  if (!userId) return err('Unauthorized', 401);

  const body   = event.body ? JSON.parse(event.body) : {};
  const date   = event.pathParameters?.date; // YYYY-MM-DD
  const method = event.httpMethod;

  // ── 日記保存（新規 or 当日の上書き）──────────────────────────
  if (!date && method === 'POST') {
    const { text, conversation, moodIdx } = body;
    if (!text) return err('textは必須です');

    const today = todayJST();
    const charCount = text.length;

    await dynamo.send(new PutItemCommand({
      TableName: TABLE,
      Item: {
        PK:           { S: `USER#${userId}` },
        SK:           { S: `DIARY#${today}` },
        date:         { S: today },
        text:         { S: text },
        conversation: { S: JSON.stringify(conversation || []) },
        moodIdx:      { N: String(moodIdx ?? 0) },
        charCount:    { N: String(charCount) },
        createdAt:    { S: new Date().toISOString() },
        updatedAt:    { S: new Date().toISOString() },
      },
    }));

    await updateStats(userId, today, charCount);
    return ok({ date: today, saved: true });
  }

  // ── 一覧取得（?month=YYYY-MM）─────────────────────────────────
  if (!date && method === 'GET') {
    const month  = event.queryStringParameters?.month;
    const prefix = month ? `DIARY#${month}` : 'DIARY#';

    const res = await dynamo.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk':     { S: `USER#${userId}` },
        ':prefix': { S: prefix },
      },
      ScanIndexForward: false,
      Limit: 50,
    }));

    const entries = (res.Items || []).map(item => ({
      date:      item.date?.S,
      text:      item.text?.S,
      moodIdx:   Number(item.moodIdx?.N ?? 0),
      charCount: Number(item.charCount?.N ?? 0),
      updatedAt: item.updatedAt?.S,
    }));

    return ok({ entries });
  }

  // ── 1件取得 ───────────────────────────────────────────────────
  if (date && method === 'GET') {
    const res = await dynamo.send(new GetItemCommand({
      TableName: TABLE,
      Key: {
        PK: { S: `USER#${userId}` },
        SK: { S: `DIARY#${date}` },
      },
    }));
    if (!res.Item) return err('Not found', 404);

    return ok({
      date:         res.Item.date?.S,
      text:         res.Item.text?.S,
      conversation: JSON.parse(res.Item.conversation?.S || '[]'),
      moodIdx:      Number(res.Item.moodIdx?.N ?? 0),
      charCount:    Number(res.Item.charCount?.N ?? 0),
      createdAt:    res.Item.createdAt?.S,
      updatedAt:    res.Item.updatedAt?.S,
    });
  }

  // ── 編集 ──────────────────────────────────────────────────────
  if (date && method === 'PUT') {
    const { text, moodIdx } = body;
    if (!text) return err('textは必須です');

    await dynamo.send(new UpdateItemCommand({
      TableName: TABLE,
      Key: {
        PK: { S: `USER#${userId}` },
        SK: { S: `DIARY#${date}` },
      },
      UpdateExpression: 'SET #text = :text, moodIdx = :mood, charCount = :chars, updatedAt = :now',
      ExpressionAttributeNames: { '#text': 'text' },
      ExpressionAttributeValues: {
        ':text':  { S: text },
        ':mood':  { N: String(moodIdx ?? 0) },
        ':chars': { N: String(text.length) },
        ':now':   { S: new Date().toISOString() },
      },
    }));

    return ok({ date, updated: true });
  }

  // ── 削除 ──────────────────────────────────────────────────────
  if (date && method === 'DELETE') {
    await dynamo.send(new DeleteItemCommand({
      TableName: TABLE,
      Key: {
        PK: { S: `USER#${userId}` },
        SK: { S: `DIARY#${date}` },
      },
    }));
    return ok({ date, deleted: true });
  }

  return err('Not found', 404);
};

async function updateStats(userId: string, date: string, charCount: number) {
  try {
    await dynamo.send(new UpdateItemCommand({
      TableName: TABLE,
      Key: { PK: { S: `USER#${userId}` }, SK: { S: 'PROFILE' } },
      UpdateExpression: 'ADD totalEntries :one, totalChars :chars SET lastEntryDate = :date',
      ExpressionAttributeValues: {
        ':one':   { N: '1' },
        ':chars': { N: String(charCount) },
        ':date':  { S: date },
      },
    }));
  } catch (e) {
    console.error('stats update failed:', e);
  }
}
