import { Router, type IRouter } from 'express';
import { getAuth } from '@clerk/express';
import { stripeStorage } from '../stripeStorage.js';
import { stripeService } from '../stripeService.js';
import { getStripePublishableKey } from '../stripeClient.js';
import { logger } from '../lib/logger.js';

const router: IRouter = Router();

router.get('/stripe/config', async (_req, res) => {
  try {
    const publishableKey = await getStripePublishableKey();
    res.json({ publishableKey });
  } catch (err: any) {
    logger.error({ err }, 'Failed to get Stripe config');
    res.status(500).json({ error: 'Failed to get Stripe config' });
  }
});

router.get('/stripe/products', async (_req, res) => {
  try {
    const products = await stripeStorage.listProductsWithPrices();
    res.json({ data: products });
  } catch (err: any) {
    logger.error({ err }, 'Failed to list products');
    res.status(500).json({ error: 'Failed to list products' });
  }
});

router.get('/stripe/subscription', async (req, res) => {
  const auth = getAuth(req);
  const userId = auth?.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    // Ensure a DB row exists for this user on first visit so we can attach
    // Stripe customer/subscription data later. Email may not be in the JWT
    // by default, so we upsert with null and let checkout populate it.
    const claims = auth.sessionClaims as any;
    const email: string | null =
      claims?.email ?? claims?.emailAddress ?? claims?.primary_email_address ?? null;
    await stripeStorage.upsertUser(userId, email);

    const status = await stripeService.getUserSubscriptionStatus(userId);
    res.json(status);
  } catch (err: any) {
    logger.error({ err }, 'Failed to get subscription');
    res.status(500).json({ error: 'Failed to get subscription' });
  }
});

router.post('/stripe/checkout', async (req, res) => {
  const auth = getAuth(req);
  const userId = auth?.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const { priceId } = req.body;
  if (!priceId) return res.status(400).json({ error: 'priceId required' });

  try {
    const claims = auth.sessionClaims as any;
    const userEmail = claims?.email ?? claims?.primary_email_address ?? null;
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const customerId = await stripeService.ensureCustomer(userId, userEmail);
    const session = await stripeService.createCheckoutSession(customerId, priceId, baseUrl);
    res.json({ url: session.url });
  } catch (err: any) {
    logger.error({ err }, 'Failed to create checkout session');
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

router.post('/stripe/portal', async (req, res) => {
  const auth = getAuth(req);
  const userId = auth?.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const user = await stripeStorage.getUser(userId);
    if (!user?.stripeCustomerId) {
      return res.status(400).json({ error: 'No billing account found' });
    }
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const session = await stripeService.createPortalSession(user.stripeCustomerId, baseUrl);
    res.json({ url: session.url });
  } catch (err: any) {
    logger.error({ err }, 'Failed to create portal session');
    res.status(500).json({ error: 'Failed to create portal session' });
  }
});

export default router;
