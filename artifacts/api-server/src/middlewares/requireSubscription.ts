import { type Request, type Response, type NextFunction } from "express";
import { getAuth, createClerkClient } from "@clerk/express";
import { stripeService } from "../stripeService.js";
import { logger } from "../lib/logger.js";

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

/**
 * Enforces an active subscription (or admin status) before allowing access to
 * protected core API routes. Admins are subscription-exempt via
 * stripeService.getUserSubscriptionStatus. Fails closed: any error or missing
 * auth results in denial.
 */
export async function requireSubscription(req: Request, res: Response, next: NextFunction) {
  const auth = getAuth(req);
  const userId = (auth?.sessionClaims as any)?.userId || auth?.userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const claims = auth.sessionClaims as any;
    let email: string | null =
      claims?.email ?? claims?.emailAddress ?? claims?.primary_email_address ?? null;

    if (!email) {
      try {
        const clerkUser = await clerk.users.getUser(userId);
        const primary = clerkUser.emailAddresses.find(
          (e: any) => e.id === clerkUser.primaryEmailAddressId
        );
        email = primary?.emailAddress ?? null;
      } catch (clerkErr) {
        logger.warn({ clerkErr }, "Could not fetch user email from Clerk for subscription check");
      }
    }

    const status = await stripeService.getUserSubscriptionStatus(userId, email);
    if (!status.active) {
      res.status(403).json({ error: "Subscription required", code: "subscription_required" });
      return;
    }

    next();
  } catch (err) {
    logger.error({ err }, "Subscription check failed");
    res.status(403).json({ error: "Subscription required", code: "subscription_required" });
  }
}
