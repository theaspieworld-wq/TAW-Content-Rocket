import { db } from '@workspace/db';
import { usersTable } from '@workspace/db';
import { eq } from 'drizzle-orm';
import { getUncachableStripeClient } from './stripeClient.js';

export class StripeStorage {
  async getUser(clerkUserId: string) {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, clerkUserId));
    return user ?? null;
  }

  async upsertUser(clerkUserId: string, email: string | null) {
    const [user] = await db
      .insert(usersTable)
      .values({ id: clerkUserId, email })
      .onConflictDoUpdate({ target: usersTable.id, set: { email } })
      .returning();
    return user;
  }

  async updateUserStripeInfo(
    clerkUserId: string,
    info: { stripeCustomerId?: string; stripeSubscriptionId?: string }
  ) {
    const [user] = await db
      .update(usersTable)
      .set(info)
      .where(eq(usersTable.id, clerkUserId))
      .returning();
    return user;
  }

  async listProductsWithPrices() {
    const stripe = await getUncachableStripeClient();
    const products = await stripe.products.list({ active: true, limit: 20 });
    const result = [];
    for (const product of products.data) {
      const prices = await stripe.prices.list({ product: product.id, active: true, limit: 10 });
      result.push({
        id: product.id,
        name: product.name,
        description: product.description ?? '',
        prices: prices.data.map(p => ({
          id: p.id,
          unitAmount: p.unit_amount ?? 0,
          currency: p.currency,
          recurring: p.recurring ? { interval: p.recurring.interval } : null,
        })),
      });
    }
    return result;
  }

  async getActiveSubscriptionForCustomer(stripeCustomerId: string) {
    const stripe = await getUncachableStripeClient();
    const subs = await stripe.subscriptions.list({
      customer: stripeCustomerId,
      status: 'active',
      limit: 1,
    });
    return subs.data[0] ?? null;
  }
}

export const stripeStorage = new StripeStorage();
