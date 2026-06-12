---
name: Hot-loaded config via app_config table
description: Pattern for runtime config/secrets that must change without a redeploy.
---

# Hot-loaded config via the `app_config` DB table

Config that an admin must be able to change on a live deployment WITHOUT a
redeploy (YouTube cookies, YouTube proxy, stripe webhook secret) is stored as
key/value rows in the `app_config` table, not as deployment env vars.

**Pattern:**
- Load all such keys into `process.env` at server startup (after migrations).
- Admin POST/DELETE routes update both the DB row AND the live `process.env`
  value in the same request, so changes take effect immediately for the running
  process.
- Sensitive values (proxy URLs with credentials) are base64-stored and masked
  before being returned to the client; never echo the raw value back.

**Why:** Replit deployment env vars require a redeploy to change. Operators need
to rotate cookies/proxies on the fly when YouTube blocks them.

**How to apply:** Admin routes are gated by `requireAdmin` (Clerk userId/email
checked against ADMIN_USER_IDS / ADMIN_EMAILS via stripeService.isAdmin).
