import app from "./app.js";
import { logger } from "./lib/logger.js";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { getUncachableStripeClient } from "./stripeClient.js";
import { spawn } from "child_process";
import net from "net";
import fs from "fs";
import path from "path";

// One-shot startup diagnostic: log resolved paths so we can diagnose
// production deployment issues with the bundled yt-dlp plugins.
function logYtdlpDiagnostics() {
  const cwd = process.cwd();
  const candidates = [
    path.resolve(cwd, "artifacts/api-server/yt-dlp-plugins"),
    path.resolve(cwd, "yt-dlp-plugins"),
    "/home/runner/workspace/artifacts/api-server/yt-dlp-plugins",
  ];
  const results = candidates.map((p) => {
    let exists = false;
    let entries: string[] = [];
    try {
      exists = fs.existsSync(p);
      if (exists) {
        const inner = path.join(p, "yt_dlp_plugins", "extractor");
        if (fs.existsSync(inner)) entries = fs.readdirSync(inner);
      }
    } catch { /* ignore */ }
    return { path: p, exists, pluginFiles: entries };
  });
  logger.info({ cwd, candidates: results }, "ytdlp plugin path diagnostics");
}

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

function isPortInUse(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const srv = net.createServer();
    srv.once("error", () => resolve(true));
    srv.once("listening", () => { srv.close(); resolve(false); });
    srv.listen(port);
  });
}

// Poll the bgutil HTTP server until it responds to /ping or times out.
async function waitForBgutil(port: number, timeoutMs = 15000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/ping`, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return true;
    } catch { /* not ready yet */ }
    await new Promise(r => setTimeout(r, 300));
  }
  return false;
}

async function startBgutilServer() {
  const serverScript = "/home/runner/workspace/bgutil-server/server/build/main.js";
  if (!fs.existsSync(serverScript)) {
    logger.warn("bgutil server script not found — PO token generation unavailable");
    return;
  }
  if (await isPortInUse(4416)) {
    logger.info("bgutil server already running on port 4416");
    return;
  }
  const child = spawn("node", [serverScript], {
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });
  child.stdout?.on("data", (d: Buffer) => logger.info({ msg: d.toString().trim() }, "bgutil"));
  child.stderr?.on("data", (d: Buffer) => logger.warn({ msg: d.toString().trim() }, "bgutil stderr"));
  child.on("error", (err: Error) => logger.warn({ err }, "bgutil server failed to start"));
  child.on("exit", (code: number | null) => logger.warn({ code }, "bgutil server exited"));

  // Wait until the server actually responds — "started" used to fire immediately
  // after spawn(), before the server was ready, causing yt-dlp to miss the HTTP
  // provider and fall back to "No request handlers configured".
  const ready = await waitForBgutil(4416, 15000);
  if (ready) {
    logger.info("bgutil PO Token server ready on port 4416");
  } else {
    logger.warn("bgutil PO Token server did not become ready within 15s — downloads will rely on script provider fallback");
  }
}

const rawPort = process.env["PORT"];
if (!rawPort) throw new Error("PORT environment variable is required");
const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) throw new Error(`Invalid PORT value: "${rawPort}"`);

logYtdlpDiagnostics();

await runMigrations();

// Start bgutil PO Token server for yt-dlp YouTube downloads (non-blocking)
startBgutilServer().catch((err) =>
  logger.warn({ err }, "bgutil server failed to start")
);

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
