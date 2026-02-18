/**
 * 綴り Stripe Lambda
 * POST /stripe/checkout → チェックアウトセッション作成
 * POST /stripe/portal   → カスタマーポータルURL取得
 * POST /stripe/webhook  → Stripe Webhook処理
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import Stripe from 'stripe';
import { dynamo, TABLE, ok, err, verifySession } from '../../shared/utils';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2024-04-10' });
const PRICE_ID       = process.env.STRIPE_PRICE_ID || '';
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const FRONTEND_URL   = process.env.FRONTEND_URL || 'https://tsuzuri.app';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  if (event.httpMethod === 'OPTIONS') return ok({});

  const path = event.path;

  // ── チェックアウト作成 ────────────────────────────────────────
  if (path.endsWith('/checkout') && event.httpMethod === 'POST') {
    const token = event.headers.Authorization || event.headers.authorization || '';
    const userId = await verifySession(token);
    if (!userId) return err('Unauthorized', 401);

    const profileRes = await dynamo.send(new GetItemCommand({
      TableName: TABLE,
      Key: { PK: { S: `USER#${userId}` }, SK: { S: 'PROFILE' } },
    }));
    const email = profileRes.Item?.email?.S || '';
    const existingCustomerId = profileRes.Item?.stripeCustomerId?.S;

    let customerId = existingCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({ email, metadata: { userId } });
      customerId = customer.id;
      await dynamo.send(new UpdateItemCommand({
        TableName: TABLE,
        Key: { PK: { S: `USER#${userId}` }, SK: { S: 'PROFILE' } },
        UpdateExpression: 'SET stripeCustomerId = :cid',
        ExpressionAttributeValues: { ':cid': { S: customerId } },
      }));
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: PRICE_ID, quantity: 1 }],
      success_url: `${FRONTEND_URL}/?checkout=success`,
      cancel_url:  `${FRONTEND_URL}/?checkout=cancel`,
      locale: 'ja',
      metadata: { userId },
    });

    return ok({ url: session.url });
  }

  // ── カスタマーポータル ────────────────────────────────────────
  if (path.endsWith('/portal') && event.httpMethod === 'POST') {
    const token = event.headers.Authorization || event.headers.authorization || '';
    const userId = await verifySession(token);
    if (!userId) return err('Unauthorized', 401);

    const profileRes = await dynamo.send(new GetItemCommand({
      TableName: TABLE,
      Key: { PK: { S: `USER#${userId}` }, SK: { S: 'PROFILE' } },
    }));
    const customerId = profileRes.Item?.stripeCustomerId?.S;
    if (!customerId) return err('Stripe顧客が見つかりません', 404);

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${FRONTEND_URL}/settings`,
    });

    return ok({ url: session.url });
  }

  // ── Webhook ───────────────────────────────────────────────────
  if (path.endsWith('/webhook') && event.httpMethod === 'POST') {
    const sig = event.headers['stripe-signature'] || '';
    let stripeEvent: Stripe.Event;

    try {
      stripeEvent = stripe.webhooks.constructEvent(event.body || '', sig, WEBHOOK_SECRET);
    } catch (e) {
      console.error('Webhook signature error:', e);
      return err('Invalid signature', 400);
    }

    switch (stripeEvent.type) {
      case 'checkout.session.completed': {
        const session = stripeEvent.data.object as Stripe.CheckoutSession;
        const userId = session.metadata?.userId;
        if (userId) {
          await dynamo.send(new UpdateItemCommand({
            TableName: TABLE,
            Key: { PK: { S: `USER#${userId}` }, SK: { S: 'PROFILE' } },
            UpdateExpression: 'SET plan = :plan',
            ExpressionAttributeValues: { ':plan': { S: 'premium' } },
          }));
        }
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = stripeEvent.data.object as Stripe.Subscription;
        const customerId = sub.customer as string;
        const customer = await stripe.customers.retrieve(customerId);
        if (customer && !customer.deleted) {
          const userId = (customer as Stripe.Customer).metadata?.userId;
          if (userId) {
            await dynamo.send(new UpdateItemCommand({
              TableName: TABLE,
              Key: { PK: { S: `USER#${userId}` }, SK: { S: 'PROFILE' } },
              UpdateExpression: 'SET plan = :plan',
              ExpressionAttributeValues: { ':plan': { S: 'free' } },
            }));
          }
        }
        break;
      }
    }

    return ok({ received: true });
  }

  return err('Not found', 404);
};
