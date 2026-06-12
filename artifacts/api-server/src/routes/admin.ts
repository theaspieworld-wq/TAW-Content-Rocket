import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { getAuth, createClerkClient } from "@clerk/express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { stripeService } from "../stripeService.js";
import { logger } from "../lib/logger.js";

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const auth = getAuth(req);
  const userId = auth?.userId;
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  let email: string | null = null;
  try {
    const clerkUser = await clerk.users.getUser(userId);
    const primary = clerkUser.emailAddresses.find(
      (e: any) => e.id === clerkUser.primaryEmailAddressId
    );
    email = primary?.emailAddress ?? null;
  } catch { /* non-fatal */ }

  if (!stripeService.isAdmin(userId, email)) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  next();
}

const router: IRouter = Router();

router.get("/admin/youtube-cookies", requireAdmin, async (_req, res) => {
  try {
    const result = await db.execute(
      sql`SELECT value FROM app_config WHERE key = 'youtube_cookies'`
    );
    const hasCookies = ((result as any).rows?.length ?? 0) > 0;
    res.json({ hasCookies });
  } catch (err: any) {
    logger.error({ err }, "Failed to get youtube cookies status");
    res.status(500).json({ error: "Failed to get cookies status" });
  }
});

router.post("/admin/youtube-cookies", requireAdmin, async (req, res) => {
  const { cookies } = req.body;
  if (!cookies || typeof cookies !== "string" || !cookies.trim()) {
    res.status(400).json({ error: "cookies (Netscape text) required" }); return;
  }

  try {
    const b64 = Buffer.from(cookies.trim()).toString("base64");
    await db.execute(
      sql`INSERT INTO app_config (key, value) VALUES ('youtube_cookies', ${b64})
          ON CONFLICT (key) DO UPDATE SET value = excluded.value`
    );
    process.env.YOUTUBE_COOKIES = b64;
    logger.info("YouTube cookies updated by admin");
    res.json({ ok: true });
  } catch (err: any) {
    logger.error({ err }, "Failed to save youtube cookies");
    res.status(500).json({ error: "Failed to save cookies" });
  }
});

router.delete("/admin/youtube-cookies", requireAdmin, async (_req, res) => {
  try {
    await db.execute(sql`DELETE FROM app_config WHERE key = 'youtube_cookies'`);
    delete process.env.YOUTUBE_COOKIES;
    logger.info("YouTube cookies cleared by admin");
    res.json({ ok: true });
  } catch (err: any) {
    logger.error({ err }, "Failed to clear youtube cookies");
    res.status(500).json({ error: "Failed to clear cookies" });
  }
});

export default router;
