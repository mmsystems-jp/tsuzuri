/**
 * 綴り 認証 Lambda (API Gateway v2対応)
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient, GetItemCommand, PutItemCommand, QueryCommand, DeleteItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { randomBytes } from 'crypto';
import * as https from 'https';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { dynamo, TABLE, cors, ok, err, verifySession, newId } from '../../shared/utils';

const ses = new SESClient({ region: 'ap-northeast-1' });
const FROM_EMAIL = process.env.FROM_EMAIL || 'noreply@tsuzuri.app';
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://tsuzuri.app';
const SESSION_TTL_DAYS = 30;
const LINE_LOGIN_CHANNEL_ID = process.env.LINE_LOGIN_CHANNEL_ID || '';

// ── LINE API helpers ─────────────────────────────────────────────
function httpsGet(hostname: string, path: string, headers: Record<string, string> = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname, path, method: 'GET', headers }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { reject(new Error('JSON parse error')); } });
    });
    req.on('error', reject);
    req.end();
  });
}

function httpsPost(hostname: string, path: string, body: string, headers: Record<string, string> = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname, path, method: 'POST', headers: { 'Content-Length': Buffer.byteLength(body).toString(), ...headers } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { reject(new Error('JSON parse error')); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function verifyLineAccessToken(accessToken: string): Promise<{ client_id: string } | null> {
  try {
    return await httpsGet('api.line.me', `/oauth2/v2.1/verify?access_token=${accessToken}`);
  } catch { return null; }
}

async function getLineProfile(accessToken: string): Promise<{ userId: string; displayName: string; pictureUrl?: string } | null> {
  try {
    return await httpsGet('api.line.me', '/v2/profile', { Authorization: `Bearer ${accessToken}` });
  } catch { return null; }
}

async function findUserByLineId(lineUserId: string): Promise<{ userId: string } | null> {
  try {
    const res = await dynamo.send(new QueryCommand({
      TableName: TABLE,
      IndexName: 'lineUserId-index',
      KeyConditionExpression: 'lineUserId = :lid',
      FilterExpression: 'SK = :sk',
      ExpressionAttributeValues: {
        ':lid': { S: lineUserId },
        ':sk':  { S: 'PROFILE' },
      },
    }));
    if (!res.Items?.length) return null;
    const userId = res.Items[0].PK?.S?.replace('USER#', '') || '';
    return { userId };
  } catch { return null; }
}

async function createUserFromLine(lineUserId: string, displayName: string, pictureUrl?: string): Promise<string> {
  const userId = newId('u');
  await dynamo.send(new PutItemCommand({
    TableName: TABLE,
    Item: {
      PK:            { S: `USER#${userId}` },
      SK:            { S: 'PROFILE' },
      lineUserId:    { S: lineUserId },
      displayName:   { S: displayName },
      ...(pictureUrl ? { pictureUrl: { S: pictureUrl } } : {}),
      plan:          { S: 'free' },
      theme:         { S: 'light' },
      notifyEnabled: { BOOL: true },
      notifyHour:    { N: '21' },
      streak:        { N: '0' },
      totalEntries:  { N: '0' },
      totalChars:    { N: '0' },
      createdAt:     { S: new Date().toISOString() },
    },
  }));
  return userId;
}

function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function generateToken(userId: string): string {
  return `tsz_${userId}_${randomBytes(16).toString('hex')}`;
}

// API Gateway v1/v2両対応でmethod/pathを取得
function getMethodAndPath(event: any): { method: string; path: string } {
  const method = (event.requestContext?.http?.method || event.httpMethod || '').toUpperCase();
  const path = event.rawPath || event.path || '';
  return { method, path };
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
      notifyEnabled: { BOOL: true },
      notifyHour:    { N: '21' },
      streak:        { N: '0' },
      totalEntries:  { N: '0' },
      totalChars:    { N: '0' },
      createdAt:     { S: new Date().toISOString() },
    },
  }));
  return userId;
}

export const handler = async (event: any): Promise<APIGatewayProxyResult> => {
  const { method, path } = getMethodAndPath(event);

  if (method === 'OPTIONS') return ok({});

  const body = event.body ? JSON.parse(event.body) : {};

  // LIFF経由でネイティブアプリを開く
  if (path.endsWith('/auth/open') && method === 'GET') {
    const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>綴りを開く</title></head>
<body>
<script>
  window.location.href = 'jp.mmsystems.cho://';
  setTimeout(function() {
    document.body.innerHTML = '<p style="font-family:sans-serif;text-align:center;margin-top:40px">綴りアプリを開いています...</p>';
  }, 500);
<\/script>
</body>
</html>`;
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: html,
    };
  }

  // LINE OAuthコールバック（ネイティブアプリ用）
  if (path.endsWith('/auth/line/callback') && method === 'GET') {
    const qs = event.queryStringParameters || {};
    const code = qs.code;
    const redirectUri = `https://o5k36gp6jd.execute-api.ap-northeast-1.amazonaws.com/auth/line/callback`;
    const lineChannelSecret = process.env.LINE_LOGIN_CHANNEL_SECRET || '';

    if (!code) {
      return { statusCode: 302, headers: { Location: 'jp.mmsystems.cho://auth?error=no_code', ...cors }, body: '' };
    }

    try {
      // コードをアクセストークンに交換
      const tokenBody = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: LINE_LOGIN_CHANNEL_ID,
        client_secret: lineChannelSecret,
      }).toString();

      const tokenData = await httpsPost('api.line.me', '/oauth2/v2.1/token', tokenBody, {
        'Content-Type': 'application/x-www-form-urlencoded',
      });

      if (!tokenData.access_token) {
        return { statusCode: 302, headers: { Location: 'jp.mmsystems.cho://auth?error=token_failed', ...cors }, body: '' };
      }

      // プロフィール取得
      const profile = await getLineProfile(tokenData.access_token);
      if (!profile) {
        return { statusCode: 302, headers: { Location: 'jp.mmsystems.cho://auth?error=profile_failed', ...cors }, body: '' };
      }

      const { userId: lineUserId, displayName, pictureUrl } = profile;

      // ユーザー検索または新規作成
      let userId: string;
      const existing = await findUserByLineId(lineUserId);
      if (existing) {
        userId = existing.userId;
      } else {
        userId = await createUserFromLine(lineUserId, displayName, pictureUrl);
      }

      // セッション生成
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

      // アプリへリダイレクト
      const deepLink = `jp.mmsystems.cho://auth?token=${encodeURIComponent(token)}&displayName=${encodeURIComponent(displayName)}&isNew=${!existing}`;
      return { statusCode: 302, headers: { Location: deepLink, ...cors }, body: '' };

    } catch (e) {
      return { statusCode: 302, headers: { Location: 'jp.mmsystems.cho://auth?error=server_error', ...cors }, body: '' };
    }
  }

  // LINE認証
  if (path.endsWith('/auth/line') && method === 'POST') {
    const { accessToken } = body;
    if (!accessToken) return err('accessTokenは必須です');

    // トークン検証
    const tokenInfo = await verifyLineAccessToken(accessToken);
    if (!tokenInfo || tokenInfo.client_id !== LINE_LOGIN_CHANNEL_ID) {
      return err('LINEトークンが無効です', 401);
    }

    // プロフィール取得
    const profile = await getLineProfile(accessToken);
    if (!profile) return err('LINEプロフィールの取得に失敗しました');

    const { userId: lineUserId, displayName, pictureUrl } = profile;

    // ユーザー検索または新規作成
    let userId: string;
    const existing = await findUserByLineId(lineUserId);
    const isNewUser = !existing;
    if (existing) {
      userId = existing.userId;
    } else {
      userId = await createUserFromLine(lineUserId, displayName, pictureUrl);
    }

    // セッション生成
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

    return ok({ token, userId, displayName, pictureUrl, isNewUser });
  }

  // OTP送信
  if (path.endsWith('/send-otp') && method === 'POST') {
    const email = body.email?.toLowerCase()?.trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return err('メールアドレスが正しくありません');
    }

    // 再送制限：既存OTPが残っている場合、作成から1分以内は再送不可
    const existing = await dynamo.send(new GetItemCommand({
      TableName: TABLE,
      Key: { PK: { S: `OTP#${email}` }, SK: { S: 'OTP' } },
    }));
    if (existing.Item) {
      const createdAt = Number(existing.Item.createdAt?.N || 0);
      const sendCount = Number(existing.Item.sendCount?.N || 0);
      const now = Math.floor(Date.now() / 1000);
      if (now - createdAt < 60) {
        return err('再送信は1分後に行ってください', 429);
      }
      if (sendCount >= 5) {
        return err('送信回数の上限に達しました。しばらくしてから試してください', 429);
      }
    }

    const otp = generateOTP();
    const expiresAt = Math.floor(Date.now() / 1000) + 10 * 60;
    const sendCount = existing.Item ? Number(existing.Item.sendCount?.N || 0) + 1 : 1;

    await dynamo.send(new PutItemCommand({
      TableName: TABLE,
      Item: {
        PK:        { S: `OTP#${email}` },
        SK:        { S: 'OTP' },
        code:      { S: otp },
        email:     { S: email },
        expiresAt: { N: String(expiresAt) },
        attempts:  { N: '0' },
        sendCount: { N: String(sendCount) },
        createdAt: { N: String(Math.floor(Date.now() / 1000)) },
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

  // OTP検証
  if (path.endsWith('/verify') && method === 'POST') {
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

  // ログインユーザー情報
  if (path.endsWith('/me') && method === 'GET') {
    const authHeader = event.headers?.Authorization || event.headers?.authorization || '';
    const userId = await verifySession(authHeader);
    if (!userId) return err('Unauthorized', 401);

    const res = await dynamo.send(new GetItemCommand({
      TableName: TABLE,
      Key: { PK: { S: `USER#${userId}` }, SK: { S: 'PROFILE' } },
    }));
    if (!res.Item) return err('User not found', 404);

    return ok({
      userId,
      email:         res.Item.email?.S,
      displayName:   res.Item.displayName?.S,
      pictureUrl:    res.Item.pictureUrl?.S,
      lineUserId:    res.Item.lineUserId?.S,
      plan:          res.Item.plan?.S,
      theme:         res.Item.theme?.S,
      notifyEnabled: res.Item.notifyEnabled?.BOOL,
      notifyHour:    Number(res.Item.notifyHour?.N),
      streak:        Number(res.Item.streak?.N),
      totalEntries:  Number(res.Item.totalEntries?.N),
      totalChars:    Number(res.Item.totalChars?.N),
    });
  }

  // ログアウト
  if (path.endsWith('/logout') && method === 'POST') {
    const authHeader = event.headers?.Authorization || event.headers?.authorization || '';
    const token = authHeader.replace('Bearer ', '');
    const userId = await verifySession(token);
    if (!userId) return ok({ message: 'ok' });

    await dynamo.send(new DeleteItemCommand({
      TableName: TABLE,
      Key: { PK: { S: `USER#${userId}` }, SK: { S: `SESSION#${token}` } },
    }));
    return ok({ message: 'ログアウトしました' });
  }

  // 設定更新（通知ON/OFFなど）
  if (path.endsWith('/auth/settings') && method === 'PATCH') {
    const authHeader = event.headers?.Authorization || event.headers?.authorization || '';
    const userId = await verifySession(authHeader);
    if (!userId) return err('Unauthorized', 401);

    const { notifyEnabled } = body;
    if (typeof notifyEnabled !== 'boolean') return err('notifyEnabled は boolean で指定してください');

    await dynamo.send(new UpdateItemCommand({
      TableName: TABLE,
      Key: { PK: { S: `USER#${userId}` }, SK: { S: 'PROFILE' } },
      UpdateExpression: 'SET notifyEnabled = :ne',
      ExpressionAttributeValues: { ':ne': { BOOL: notifyEnabled } },
    }));

    return ok({ notifyEnabled });
  }

  return err('Not found', 404);
};
