---
name: Autoscale video uploads
description: Production upload constraint for large Content Rocket source videos.
---

For browser video uploads, send file bytes directly to object storage with a presigned URL. Do not stage multipart chunks in an API server's local temporary filesystem.

**Why:** Autoscaling can route sequential upload and assembly requests to different instances, so local temporary chunk state is not reliable outside development. Direct storage uploads also avoid a second server-to-storage transfer.

**How to apply:** Keep the API request small (metadata plus a presigned upload URL), upload from the browser with a generous timeout and progress events, then create the processing job using the returned object path.