import type Stripe from 'stripe';
import { stripeStorage } from './stripeStorage.js';
import { logger } from './lib/logger.js';

export async function handleStripeEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode !== 'subscription' || !session.customer || !session.subscription) break;
      const customerId = typeof session.customer === 'string' ? session.customer : session.customer.id;
      const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription.id;
      await stripeStorage.setSubscriptionByCustomerId(customerId, subscriptionId);
      logger.info({ customerId, subscriptionId }, 'Stripe: subscription activated via checkout');
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
      break;
    }

    default:
      logger.debug({ type: event.type }, 'Stripe: unhandled event type');
  }
}
