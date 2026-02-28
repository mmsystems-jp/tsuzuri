/**
 * 綴り 日記 Lambda (API Gateway v2対応)
 */

import { APIGatewayProxyResult } from 'aws-lambda';
import { PutItemCommand, GetItemCommand, QueryCommand, UpdateItemCommand, DeleteItemCommand } from '@aws-sdk/client-dynamodb';
import { dynamo, TABLE, ok, err, verifySession, todayJST } from '../../shared/utils';

const CLAUDE_API = 'https://api.anthropic.com/v1/messages';

function getMethodAndPath(event: any): { method: string; path: string } {
  const method = (event.requestContext?.http?.method || event.httpMethod || '').toUpperCase();
  const path = event.rawPath || event.path || '';
  return { method, path };
}

export const handler = async (event: any): Promise<APIGatewayProxyResult> => {
  const { method, path } = getMethodAndPath(event);

  if (method === 'OPTIONS') return ok({});

  const authHeader = event.headers?.Authorization || event.headers?.authorization || '';
  const userId = await verifySession(authHeader);
  if (!userId) return err('Unauthorized', 401);

  const body = event.body ? JSON.parse(event.body) : {};

  // プロフィール取得（直近3日の日記含む）
  if (method === 'GET' && path.endsWith('/profile')) {
    return handleGetProfile(userId);
  }

  // パスから日付を取得 /diary/2026-02-18 → 2026-02-18
  const dateMatch = path.match(/\/diary\/(\d{4}-\d{2}-\d{2})$/);
  const date = dateMatch ? dateMatch[1] : null;

  // 日記保存（新規 or 指定日の上書き）
  if (!date && method === 'POST') {
    const { text, conversation, moodIdx } = body;
    if (!text) return err('textは必須です');

    const today = todayJST();
    // bodyのdateを使う。未来日・形式不正は今日にフォールバック
    const targetDate = (body.date && /^\d{4}-\d{2}-\d{2}$/.test(body.date) && body.date <= today)
      ? body.date
      : today;
    const charCount = text.length;

    await dynamo.send(new PutItemCommand({
      TableName: TABLE,
      Item: {
        PK:           { S: `USER#${userId}` },
        SK:           { S: `DIARY#${targetDate}` },
        date:         { S: targetDate },
        text:         { S: text },
        conversation: { S: JSON.stringify(conversation || []) },
        moodIdx:      { N: String(moodIdx ?? 0) },
        charCount:    { N: String(charCount) },
        createdAt:    { S: new Date().toISOString() },
        updatedAt:    { S: new Date().toISOString() },
      },
    }));

    await updateStats(userId, targetDate, charCount);
    // プロフィール抽出（fire-and-forget）
    extractAndUpdateProfile(userId, text, conversation || []);
    return ok({ date: targetDate, saved: true });
  }

  // 一覧取得（?month=YYYY-MM）
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

  // 1件取得
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

  // 編集
  if (date && method === 'PUT') {
    const { text, moodIdx, conversation } = body;
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

    // プロフィール抽出（fire-and-forget）
    extractAndUpdateProfile(userId, text, conversation || []);
    return ok({ date, updated: true });
  }

  // 削除
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

// GET /profile: aiProfile と直近3日の日記テキストを返す
async function handleGetProfile(userId: string): Promise<APIGatewayProxyResult> {
  const [profileRes, diariesRes] = await Promise.all([
    dynamo.send(new GetItemCommand({
      TableName: TABLE,
      Key: { PK: { S: `USER#${userId}` }, SK: { S: 'PROFILE' } },
    })),
    dynamo.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk':     { S: `USER#${userId}` },
        ':prefix': { S: 'DIARY#' },
      },
      ScanIndexForward: false,
      Limit: 3,
    })),
  ]);

  const aiProfile = profileRes.Item?.aiProfile?.S || null;
  const recentDiaries = (diariesRes.Items || []).map(item => ({
    date: item.date?.S,
    text: item.text?.S,
  }));

  return ok({ aiProfile, recentDiaries });
}

// プロフィール抽出・更新（fire-and-forget で呼ぶ）
async function extractAndUpdateProfile(userId: string, diaryText: string, conversation: any[]) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY || '';
    if (!apiKey) return;

    // 既存プロフィール取得
    const profileRes = await dynamo.send(new GetItemCommand({
      TableName: TABLE,
      Key: { PK: { S: `USER#${userId}` }, SK: { S: 'PROFILE' } },
    }));
    const existingProfile = profileRes.Item?.aiProfile?.S || '';

    const prompt = `以下の日記と会話から、書いた人物の特徴を JSON で抽出してください。
既存のプロフィール情報があればそれを優先し、新しい情報があれば追加・更新してください。
出力は以下のキーを持つJSONのみ（説明文不要）：
occupation（職業・仕事）, family（家族構成）, hobbies（趣味・興味）, personality（性格傾向）, topics（よく話すテーマ）
各フィールドは文字列。情報がなければ空文字。

既存プロフィール：${existingProfile}
日記：${diaryText}`;

    const res = await fetch(CLAUDE_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const data = await res.json() as any;
    const text: string = data.content?.[0]?.text || '{}';

    // JSON部分を抽出（コードブロック対応）
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return;
    JSON.parse(jsonMatch[0]); // バリデーション
    const newProfile = jsonMatch[0];

    await dynamo.send(new UpdateItemCommand({
      TableName: TABLE,
      Key: { PK: { S: `USER#${userId}` }, SK: { S: 'PROFILE' } },
      UpdateExpression: 'SET aiProfile = :profile',
      ExpressionAttributeValues: {
        ':profile': { S: newProfile },
      },
    }));
  } catch (e) {
    console.error('extractAndUpdateProfile failed:', e);
  }
}
