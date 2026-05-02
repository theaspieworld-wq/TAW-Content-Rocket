import { stripeStorage } from './stripeStorage.js';
import { getUncachableStripeClient } from './stripeClient.js';

export class StripeService {
  async ensureCustomer(clerkUserId: string, email: string | null) {
    let user = await stripeStorage.getUser(clerkUserId);
    if (!user) {
      user = await stripeStorage.upsertUser(clerkUserId, email);
    }
    if (user.stripeCustomerId) return user.stripeCustomerId;

    const stripe = await getUncachableStripeClient();
    const customer = await stripe.customers.create({
      email: email ?? undefined,
      metadata: { clerkUserId },
    });
    await stripeStorage.updateUserStripeInfo(clerkUserId, { stripeCustomerId: customer.id });
    return customer.id;
  }

  async createCheckoutSession(customerId: string, priceId: string, baseUrl: string) {
    const stripe = await getUncachableStripeClient();
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      success_url: `${baseUrl}/app?subscribed=1`,
      cancel_url: `${baseUrl}/pricing`,
    });
    return session;
  }

  async createPortalSession(customerId: string, baseUrl: string) {
    const stripe = await getUncachableStripeClient();
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${baseUrl}/app`,
    });
    return session;
  }

  async getUserSubscriptionStatus(clerkUserId: string) {
    const user = await stripeStorage.getUser(clerkUserId);
    if (!user?.stripeCustomerId) return { active: false, subscription: null };

    // Primary path: trust the DB value kept in sync by Stripe webhooks.
    // This avoids a live Stripe API call on every page load and is resilient
    // to brief Stripe outages.
    if (user.stripeSubscriptionId) {
      return { active: true, subscription: { id: user.stripeSubscriptionId } };
    }

    // Fallback: live Stripe check in case a webhook was missed (e.g. during
    // development, first deploy, etc.).  If we find an active sub, sync it
    // into the DB so future requests take the fast path.
    const sub = await stripeStorage.getActiveSubscriptionForCustomer(user.stripeCustomerId);
    if (sub) {
      await stripeStorage.setSubscriptionByCustomerId(user.stripeCustomerId, sub.id);
      return { active: true, subscription: sub };
    }

    return { active: false, subscription: null };
  }
}

export const stripeService = new StripeService();
