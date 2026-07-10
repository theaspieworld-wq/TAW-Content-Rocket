---
name: Large file uploads must bypass the shared proxy via presigned URLs
description: Multipart form-post uploads through the Replit shared proxy silently hang for large files; direct-to-object-storage presigned URL uploads are required.
---

Browser multipart uploads >~1GB posted through the Replit shared proxy (dev preview iframe) can hang indefinitely at 0% — the request never reaches the app server at all, even after 5+ minutes, and nothing shows in server logs. Bumping multer's `fileSize` limit does NOT fix this since the failure is upstream of the server (proxy/browser layer), not multer.

**Why:** The shared reverse proxy that fronts artifact preview traffic is not reliable for very large multipart bodies. The API server itself responds instantly to unrelated requests (confirmed via curl) during the hang, ruling out server-side blocking.

**How to apply:** For uploads that may exceed ~1GB (video, large media), skip multipart-through-proxy entirely. Use the `object-storage` skill's presigned-URL pattern instead: client requests a presigned PUT URL from the API server, then PUTs file bytes directly to GCS from the browser (bypassing the app's proxy path), then posts lightweight JSON metadata (object path + form fields) to a separate endpoint that creates the DB record and kicks off processing. The processing/worker step then pulls the object down from storage to local disk on demand. Keep the old small-file multipart route only if you still need it for backward compatibility with existing local-path records.
