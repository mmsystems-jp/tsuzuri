/**
 * 綴り 認証 Lambda
 * POST /auth/send-otp  → OTPをメール送信
 * POST /auth/verify    → OTP検証 → セッショントークン返却
 * GET  /auth/me        → ログイン中ユーザー情報
 * POST /auth/logout    → セッション削除
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient, GetItemCommand, PutItemCommand, QueryCommand, DeleteItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { dynamo, TABLE, cors, ok, err, verifySession, newId } from '../../shared/utils';

const ses = new SESClient({ region: 'ap-northeast-1' });
const FROM_EMAIL = process.env.FROM_EMAIL || 'noreply@tsuzuri.app';
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://tsuzuri.app';
const SESSION_TTL_DAYS = 30;

function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function generateToken(userId: string): string {
  return `tsz_${userId}_${Math.random().toString(36).slice(2, 10)}`;
}

async function findUserByEmail(email: string): Promise<{ userId: string } | null> {
  try {
    const res = await dynamo.send(new QueryCommand({
      TableName: TABLE,
      IndexName: 'email-index',
      KeyConditionExpression: 'email = :email',
      FilterExpression: 'SK = :sk',
      ExpressionAttributeValues: {
        ':email': { S: email.toLowerCase() },
        ':sk':    { S: 'PROFILE' },
      },
    }));
    if (!res.Items?.length) return null;
    const userId = res.Items[0].PK?.S?.replace('USER#', '') || '';
    return { userId };
  } catch {
    return null;
  }
}

async function createUser(email: string): Promise<string> {
  const userId = newId('u');
  await dynamo.send(new PutItemCommand({
    TableName: TABLE,
    Item: {
      PK:            { S: `USER#${userId}` },
      SK:            { S: 'PROFILE' },
      email:         { S: email.toLowerCase() },
      plan:          { S: 'free' },
      theme:         { S: 'light' },
      notifyEnabled: { BOOL: false },
      notifyHour:    { N: '21' },
      streak:        { N: '0' },
      totalEntries:  { N: '0' },
      totalChars:    { N: '0' },
      createdAt:     { S: new Date().toISOString() },
    },
  }));
  return userId;
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  if (event.httpMethod === 'OPTIONS') return ok({});

  const path = event.path;
  const body = event.body ? JSON.parse(event.body) : {};

  // ── OTP送信 ────────────────────────────────────────────────────
  if (path.endsWith('/send-otp') && event.httpMethod === 'POST') {
    const email = body.email?.toLowerCase()?.trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return err('メールアドレスが正しくありません');
    }

    const otp = generateOTP();
    const expiresAt = Math.floor(Date.now() / 1000) + 10 * 60; // 10分

    await dynamo.send(new PutItemCommand({
      TableName: TABLE,
      Item: {
        PK:        { S: `OTP#${email}` },
        SK:        { S: 'OTP' },
        code:      { S: otp },
        email:     { S: email },
        expiresAt: { N: String(expiresAt) },
        attempts:  { N: '0' },
      },
    }));

    await ses.send(new SendEmailCommand({
      Source: FROM_EMAIL,
      Destination: { ToAddresses: [email] },
      Message: {
        Subject: { Data: '【綴り】ログインコード', Charset: 'UTF-8' },
        Body: {
          Text: {
            Data: `綴りのログインコードは\n\n${otp}\n\nこのコードは10分間有効です。\n心当たりのない場合は無視してください。`,
            Charset: 'UTF-8',
          },
        },
      },
    }));

    return ok({ message: 'OTPを送信しました' });
  }

  // ── OTP検証 ────────────────────────────────────────────────────
  if (path.endsWith('/verify') && event.httpMethod === 'POST') {
    const email = body.email?.toLowerCase()?.trim();
    const code  = body.code?.trim();
    if (!email || !code) return err('メールアドレスとコードは必須です');

    const res = await dynamo.send(new GetItemCommand({
      TableName: TABLE,
      Key: { PK: { S: `OTP#${email}` }, SK: { S: 'OTP' } },
    }));

    if (!res.Item) return err('コードが見つかりません。再送信してください', 400);

    const expiresAt = Number(res.Item.expiresAt?.N || 0);
    const attempts  = Number(res.Item.attempts?.N || 0);

    if (Date.now() / 1000 > expiresAt) return err('コードの有効期限が切れました', 400);
    if (attempts >= 5) return err('試行回数の上限に達しました。再送信してください', 400);
    if (res.Item.code?.S !== code) {
      await dynamo.send(new PutItemCommand({
        TableName: TABLE,
        Item: { ...res.Item, attempts: { N: String(attempts + 1) } },
      }));
      return err('コードが正しくありません', 400);
    }

    await dynamo.send(new DeleteItemCommand({
      TableName: TABLE,
      Key: { PK: { S: `OTP#${email}` }, SK: { S: 'OTP' } },
    }));

    let userId: string;
    const existing = await findUserByEmail(email);
    if (existing) {
      userId = existing.userId;
    } else {
      userId = await createUser(email);
    }

    const token = generateToken(userId);
    const sessionTTL = Math.floor(Date.now() / 1000) + SESSION_TTL_DAYS * 24 * 60 * 60;
    await dynamo.send(new PutItemCommand({
      TableName: TABLE,
      Item: {
        PK:        { S: `USER#${userId}` },
        SK:        { S: `SESSION#${token}` },
        token:     { S: token },
        expiresAt: { N: String(sessionTTL) },
        createdAt: { S: new Date().toISOString() },
      },
    }));

    return ok({ token, userId, isNewUser: !existing });
  }

  // ── ログインユーザー情報 ───────────────────────────────────────
  if (path.endsWith('/me') && event.httpMethod === 'GET') {
    const userId = await verifySession(event.headers.Authorization || event.headers.authorization || '');
    if (!userId) return err('Unauthorized', 401);

    const res = await dynamo.send(new GetItemCommand({
      TableName: TABLE,
      Key: { PK: { S: `USER#${userId}` }, SK: { S: 'PROFILE' } },
    }));
    if (!res.Item) return err('User not found', 404);

    return ok({
      userId,
      email:         res.Item.email?.S,
      plan:          res.Item.plan?.S,
      theme:         res.Item.theme?.S,
      notifyEnabled: res.Item.notifyEnabled?.BOOL,
      notifyHour:    Number(res.Item.notifyHour?.N),
      streak:        Number(res.Item.streak?.N),
      totalEntries:  Number(res.Item.totalEntries?.N),
      totalChars:    Number(res.Item.totalChars?.N),
    });
  }

  // ── ログアウト ─────────────────────────────────────────────────
  if (path.endsWith('/logout') && event.httpMethod === 'POST') {
    const token = (event.headers.Authorization || event.headers.authorization || '').replace('Bearer ', '');
    const userId = await verifySession(token);
    if (!userId) return ok({ message: 'ok' });

    await dynamo.send(new DeleteItemCommand({
      TableName: TABLE,
      Key: { PK: { S: `USER#${userId}` }, SK: { S: `SESSION#${token}` } },
    }));
    return ok({ message: 'ログアウトしました' });
  }

  return err('Not found', 404);
};
