import type Stripe from 'stripe';
import { stripeStorage } from './stripeStorage.js';
import { logger } from './lib/logger.js';
import { sendSubscriptionConfirmation, sendPaymentFailed } from './emailService.js';
import { getUncachableStripeClient } from './stripeClient.js';

async function getCustomerEmail(customerId: string): Promise<string | null> {
  // Try the DB first (fastest, no extra API call)
  const user = await stripeStorage.getUserByStripeCustomerId(customerId);
  if (user?.email) return user.email;

  // Fall back to Stripe
  try {
    const stripe = await getUncachableStripeClient();
    const customer = await stripe.customers.retrieve(customerId);
    if (!customer.deleted && customer.email) return customer.email;
  } catch {
    // non-fatal
  }
  return null;
}

async function getPlanLabel(priceId: string | null): Promise<string> {
  if (!priceId) return 'Content Rocket Pro';
  try {
    const stripe = await getUncachableStripeClient();
    const price = await stripe.prices.retrieve(priceId, { expand: ['product'] });
    const product = price.product as Stripe.Product;
    const interval = price.recurring?.interval;
    const suffix = interval === 'year' ? 'Yearly' : interval === 'month' ? 'Monthly' : '';
    return suffix ? `${product.name} (${suffix})` : product.name;
  } catch {
    return 'Content Rocket Pro';
  }
}

export async function handleStripeEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {

    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode !== 'subscription' || !session.customer || !session.subscription) break;

      const customerId = typeof session.customer === 'string' ? session.customer : session.customer.id;
      const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription.id;

      await stripeStorage.setSubscriptionByCustomerId(customerId, subscriptionId);
      logger.info({ customerId, subscriptionId }, 'Stripe: subscription activated via checkout');

      // Send welcome / access email
      const email = session.customer_email ?? await getCustomerEmail(customerId);
      if (email) {
        const stripe = await getUncachableStripeClient();
        const sub = await stripe.subscriptions.retrieve(subscriptionId);
        const priceId = sub.items.data[0]?.price?.id ?? null;
        const planLabel = await getPlanLabel(priceId);
        await sendSubscriptionConfirmation(email, planLabel);
      } else {
        logger.warn({ customerId }, 'Stripe: no email found for customer — skipping welcome email');
      }
      break;
    }

    case 'customer.subscription.updated': {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
      const isActive = ['active', 'trialing'].includes(sub.status);
      await stripeStorage.setSubscriptionByCustomerId(customerId, isActive ? sub.id : null);
      logger.info({ customerId, status: sub.status }, 'Stripe: subscription updated');
      break;
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
      await stripeStorage.setSubscriptionByCustomerId(customerId, null);
      logger.info({ customerId }, 'Stripe: subscription deleted');
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
      logger.warn({ customerId, invoiceId: invoice.id }, 'Stripe: invoice payment failed');

      // Send payment-failed alert email
      const email = invoice.customer_email ?? (customerId ? await getCustomerEmail(customerId) : null);
      if (email) {
        await sendPaymentFailed(email);
      } else {
        logger.warn({ customerId }, 'Stripe: no email found — skipping payment-failed email');
      }
      break;
    }

    default:
      logger.debug({ type: event.type }, 'Stripe: unhandled event type');
  }
}
