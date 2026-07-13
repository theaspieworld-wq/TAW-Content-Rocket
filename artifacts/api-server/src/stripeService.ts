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

  async createCheckoutSession(
    customerId: string,
    priceId: string,
    baseUrl: string,
    promotionCodeId?: string | null,
  ) {
    const stripe = await getUncachableStripeClient();
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      success_url: `${baseUrl}/app?subscribed=1`,
      cancel_url: `${baseUrl}/pricing`,
      ...(promotionCodeId ? { discounts: [{ promotion_code: promotionCodeId }] } : { allow_promotion_codes: false }),
    });
    return session;
  }

  async validatePromoCode(code: string): Promise<{
    valid: boolean;
    promotionCodeId: string | null;
    couponId: string | null;
    percentOff: number | null;
    amountOff: number | null;
    currency: string | null;
    name: string | null;
  }> {
    const stripe = await getUncachableStripeClient();
    const results = await stripe.promotionCodes.list({ code, active: true, limit: 1 });
    const pc = results.data[0];
    if (!pc) return { valid: false, promotionCodeId: null, couponId: null, percentOff: null, amountOff: null, currency: null, name: null };
    const coupon = pc.coupon as any;
    return {
      valid: true,
      promotionCodeId: pc.id,
      couponId: coupon.id,
      percentOff: coupon.percent_off ?? null,
      amountOff: coupon.amount_off ?? null,
      currency: coupon.currency ?? null,
      name: coupon.name ?? null,
    };
  }

  async createFreeSubscription(customerId: string, priceId: string, promotionCodeId: string): Promise<string> {
    const stripe = await getUncachableStripeClient();
    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
      discounts: [{ promotion_code: promotionCodeId }],
    });
    return subscription.id;
  }

  async createPortalSession(customerId: string, baseUrl: string) {
    const stripe = await getUncachableStripeClient();
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${baseUrl}/app`,
    });
    return session;
  }

  isAdmin(clerkUserId: string, email?: string | null): boolean {
    const adminIds = (process.env.ADMIN_USER_IDS ?? '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    if (adminIds.includes(clerkUserId)) return true;

    // Email-based fallback — covers cases where a new OAuth account was
    // created for the same address, or the user ID hasn't been added yet.
    if (email) {
      const adminEmails = (process.env.ADMIN_EMAILS ?? '')
        .split(',')
        .map(s => s.trim().toLowerCase())
        .filter(Boolean);
      if (adminEmails.includes(email.toLowerCase())) return true;
    }

    return false;
  }

  async getUserSubscriptionStatus(clerkUserId: string, email?: string | null) {
    // Admin bypass — no subscription required
    if (this.isAdmin(clerkUserId, email)) {
      return { active: true, isAdmin: true, subscription: null };
    }

    const user = await stripeStorage.getUser(clerkUserId);
    if (!user?.stripeCustomerId) return { active: false, isAdmin: false, subscription: null };

    // Primary path: trust the DB value kept in sync by Stripe webhooks.
    // This avoids a live Stripe API call on every page load and is resilient
    // to brief Stripe outages.
    if (user.stripeSubscriptionId) {
      return { active: true, isAdmin: false, subscription: { id: user.stripeSubscriptionId } };
    }

    // Fallback: live Stripe check in case a webhook was missed (e.g. during
    // development, first deploy, etc.).  If we find an active sub, sync it
    // into the DB so future requests take the fast path.
    const sub = await stripeStorage.getActiveSubscriptionForCustomer(user.stripeCustomerId);
    if (sub) {
      await stripeStorage.setSubscriptionByCustomerId(user.stripeCustomerId, sub.id);
      return { active: true, isAdmin: false, subscription: sub };
    }

    return { active: false, isAdmin: false, subscription: null };
  }
}

export const stripeService = new StripeService();
