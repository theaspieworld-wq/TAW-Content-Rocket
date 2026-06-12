---
name: Subscription gate enforcement (Content Rocket)
description: How the Stripe paywall must be enforced and the bypass for admins.
---

# Subscription gate — enforce on the server, not just the UI

A paywall that only hides the UI is not a paywall. A signed-in user can call the
API directly and bypass a frontend-only gate.

**Rule:** the gate needs TWO layers that stay in sync:
1. Frontend (`App.tsx useSubscriptionStatus` + `AppPage`) — UX: loading spinner,
   "Subscription required" screen → `/pricing`, or the app.
2. Server middleware (`requireSubscription`) — real enforcement on core data
   routes (`jobs`/`outros`/`brands`). Mounted AFTER `requireAuth`/`me`/`admin`
   so pricing, account, and admin routes stay reachable for unsubscribed users.

**Why:** a code review caught that re-enabling only the frontend gate left the
core APIs open to any authenticated user.

**How to apply:**
- Admin bypass lives in `stripeService.getUserSubscriptionStatus` /
  `isAdmin` (checks `ADMIN_USER_IDS` / `ADMIN_EMAILS`). Both layers call it, so
  admins (e.g. teamtawsupport@gmail.com) get `active:true` with no subscription.
- Fail CLOSED: on any error or unconfirmed status, a non-admin is denied
  (frontend `catch` → inactive unless already confirmed active; middleware
  `catch` → 403).
- Frontend sessionStorage cache keys MUST be scoped per `user.id`
  (`cr_subStatus_<id>`), or switching accounts in one browser session leaks the
  previous user's active state.
