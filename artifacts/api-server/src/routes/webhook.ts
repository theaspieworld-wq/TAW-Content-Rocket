import { Router, type IRouter } from 'express';
import { db } from '@workspace/db';
import { sql } from 'drizzle-orm';
import { getUncachableStripeClient } from '../stripeClient.js';
import { handleStripeEvent } from '../webhookHandler.js';
import { logger } from '../lib/logger.js';

const router: IRouter = Router();

// Module-level cache so we only hit the DB once per process lifetime
let cachedSecret: string | null = null;

async function getWebhookSecret(): Promise<string | null> {
  if (cachedSecret) return cachedSecret;
  const result = await db.execute(
    sql`SELECT value FROM app_config WHERE key = 'stripe_webhook_secret'`
  );
  const value = (result as any).rows?.[0]?.value ?? null;
  if (value) cachedSecret = value;
  return value;
}

// NOTE: This route receives a raw Buffer body (mounted in app.ts before express.json())
router.post('/stripe/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  if (!sig || typeof sig !== 'string') {
    res.status(400).json({ error: 'Missing stripe-signature header' });
    return;
  }

  const webhookSecret = await getWebhookSecret();
  if (!webhookSecret) {
    logger.error('Stripe webhook secret not configured — run server startup to register it');
    res.status(500).json({ error: 'Webhook not yet configured' });
    return;
  }

  let event;
  try {
    const stripe = await getUncachableStripeClient();
    event = stripe.webhooks.constructEvent(req.body as Buffer, sig, webhookSecret);
  } catch (err: any) {
    logger.error({ err }, 'Stripe webhook signature verification failed');
    res.status(400).json({ error: `Webhook signature error: ${err.message}` });
    return;
  }

  // Respond immediately so Stripe doesn't time out, then process
  res.json({ received: true });

  handleStripeEvent(event).catch((err) =>
    logger.error({ err, type: event.type }, 'Error handling Stripe event')
  );
});

export default router;
