---
name: YouTube download bot-block in production
description: Why yt-dlp downloads fail on deployed Content Rocket and the available fixes.
---

# YouTube "Sign in to confirm you're not a bot"

Deployed apps run on datacenter IPs. YouTube bot-detects these and rejects yt-dlp
downloads with "Sign in to confirm you're not a bot". This works fine in the dev
container (different IP reputation) but fails once published — so it is NOT
reproducible locally.

**Reliability ranking of fixes:**
1. **Residential/rotating proxy** (`--proxy`) — the reliable, set-and-forget fix.
   YouTube never sees the datacenter IP. Costs money (Webshare/IPRoyal/etc).
2. **Cookies** (`--cookies` from a Netscape cookies.txt) — fragile stopgap.
   Cookies exported from a browser can still be rejected when replayed from a
   datacenter IP, and they expire every few weeks needing manual re-paste.

**Why:** YouTube's block is IP-reputation based first, identity second. A proxy
fixes the IP; cookies only prove identity and don't fully overcome the IP signal.

**How to apply:** Both proxy and cookies are admin-managed via the Admin tab
(stored in `app_config`, hot-loaded — no redeploy). Don't force specific yt-dlp
player clients (tv_embedded etc.) — they break on yt-dlp 2026+. Let the default
client run and layer proxy/cookies on top via baseArgs in processor.ts.
