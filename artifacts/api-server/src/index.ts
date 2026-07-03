import app from "./app.js";
import { logger } from "./lib/logger.js";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { getUncachableStripeClient } from "./stripeClient.js";

async function runMigrations() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT,
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS app_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
  logger.info("DB tables ready");
}

async function registerStripeWebhook() {
  const domain = process.env.REPLIT_DOMAINS?.split(",")[0];
  if (!domain) {
    logger.warn("REPLIT_DOMAINS not set — skipping Stripe webhook registration");
    return;
  }

  try {
    // Check if we already have the secret stored
    const existing = await db.execute(
      sql`SELECT value FROM app_config WHERE key = 'stripe_webhook_secret'`
    );
    if ((existing as any).rows?.length > 0) {
      logger.info("Stripe webhook already registered");
      return;
    }

    const webhookUrl = `https://${domain}/api/stripe/webhook`;
    const stripe = await getUncachableStripeClient();

    // Remove any stale endpoints for this URL first
    const list = await stripe.webhookEndpoints.list({ limit: 100 });
    for (const ep of list.data) {
      if (ep.url === webhookUrl) {
        await stripe.webhookEndpoints.del(ep.id);
        logger.info({ id: ep.id }, "Removed stale Stripe webhook endpoint");
      }
    }

    // Create fresh endpoint
    const endpoint = await stripe.webhookEndpoints.create({
      url: webhookUrl,
      enabled_events: [
        "checkout.session.completed",
        "customer.subscription.updated",
        "customer.subscription.deleted",
        "invoice.payment_failed",
      ],
    });

    // secret is only returned on creation — store it persistently
    await db.execute(
      sql`INSERT INTO app_config (key, value) VALUES ('stripe_webhook_secret', ${endpoint.secret!})
          ON CONFLICT (key) DO UPDATE SET value = excluded.value`
    );

    logger.info({ url: webhookUrl }, "Stripe webhook registered and secret stored");
  } catch (err: any) {
    logger.error({ err }, "Failed to register Stripe webhook (non-fatal — will retry on next restart)");
  }
}

process.on("uncaughtException", (err) => {
  logger.error({ err }, "Uncaught exception — process will continue running");
});

process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "Unhandled promise rejection — process will continue running");
});

const rawPort = process.env["PORT"];
if (!rawPort) throw new Error("PORT environment variable is required");
const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) throw new Error(`Invalid PORT value: "${rawPort}"`);

await runMigrations();

// Register webhook in background — don't block server startup
registerStripeWebhook().catch((err) =>
  logger.error({ err }, "Stripe webhook registration failed")
);

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }
  logger.info({ port }, "Server listening");
});
