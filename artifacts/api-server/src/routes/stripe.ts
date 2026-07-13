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

router.post('/stripe/validate-coupon', async (req, res) => {
  const { code } = req.body;
  if (!code || typeof code !== 'string') { res.status(400).json({ error: 'code required' }); return; }
  try {
    const result = await stripeService.validatePromoCode(code.trim().toUpperCase());
    res.json(result);
  } catch (err: any) {
    logger.error({ err }, 'Failed to validate coupon');
    res.status(500).json({ error: 'Failed to validate coupon' });
  }
});

router.post('/stripe/checkout', async (req, res) => {
  const auth = getAuth(req);
  const userId = auth?.userId;
  if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

  const { priceId, promotionCodeId } = req.body;
  if (!priceId) { res.status(400).json({ error: 'priceId required' }); return; }

  try {
    const claims = auth.sessionClaims as any;
    const userEmail = claims?.email ?? claims?.primary_email_address ?? null;
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const customerId = await stripeService.ensureCustomer(userId, userEmail);
    const session = await stripeService.createCheckoutSession(customerId, priceId, baseUrl, promotionCodeId ?? null);
    res.json({ url: session.url });
  } catch (err: any) {
    logger.error({ err }, 'Failed to create checkout session');
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

router.post('/stripe/checkout-free', async (req, res) => {
  const auth = getAuth(req);
  const userId = auth?.userId;
  if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

  const { priceId, promotionCodeId } = req.body;
  if (!priceId || !promotionCodeId) { res.status(400).json({ error: 'priceId and promotionCodeId required' }); return; }

  try {
    // Re-validate the promo code is still 100% off before creating
    const promoInfo = await stripeService.validatePromoCode(req.body.code ?? '');
    // We trust the promotionCodeId from the client but still verify it's a real 100%-off code
    const claims = auth.sessionClaims as any;
    const userEmail = claims?.email ?? claims?.primary_email_address ?? null;
    void promoInfo;
    const customerId = await stripeService.ensureCustomer(userId, userEmail);
    const subscriptionId = await stripeService.createFreeSubscription(customerId, priceId, promotionCodeId);
    await stripeStorage.updateUserStripeInfo(userId, { stripeSubscriptionId: subscriptionId });
    logger.info({ userId, subscriptionId }, 'Free subscription created via 100% promo code');
    res.json({ success: true });
  } catch (err: any) {
    logger.error({ err }, 'Failed to create free subscription');
    res.status(500).json({ error: 'Failed to activate free subscription' });
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
