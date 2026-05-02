import { Router, type IRouter } from 'express';
import { getAuth, createClerkClient } from '@clerk/express';
import { stripeStorage } from '../stripeStorage.js';
import { stripeService } from '../stripeService.js';
import { getStripePublishableKey } from '../stripeClient.js';
import { logger } from '../lib/logger.js';

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

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
  if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

  try {
    const claims = auth.sessionClaims as any;
    let email: string | null =
      claims?.email ?? claims?.emailAddress ?? claims?.primary_email_address ?? null;

    // JWT doesn't include email by default — fetch from Clerk directly so the
    // admin email bypass always has a real value to compare against.
    if (!email) {
      try {
        const clerkUser = await clerk.users.getUser(userId);
        const primary = clerkUser.emailAddresses.find(
          (e: any) => e.id === clerkUser.primaryEmailAddressId
        );
        email = primary?.emailAddress ?? null;
      } catch (clerkErr) {
        logger.warn({ clerkErr }, 'Could not fetch user email from Clerk');
      }
    }

    await stripeStorage.upsertUser(userId, email);

    const status = await stripeService.getUserSubscriptionStatus(userId, email);
    res.json(status);
  } catch (err: any) {
    logger.error({ err }, 'Failed to get subscription');
    res.status(500).json({ error: 'Failed to get subscription' });
  }
});

router.post('/stripe/checkout', async (req, res) => {
  const auth = getAuth(req);
  const userId = auth?.userId;
  if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

  const { priceId } = req.body;
  if (!priceId) { res.status(400).json({ error: 'priceId required' }); return; }

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
  if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

  try {
    const user = await stripeStorage.getUser(userId);
    if (!user?.stripeCustomerId) {
      res.status(400).json({ error: 'No billing account found' });
      return;
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
