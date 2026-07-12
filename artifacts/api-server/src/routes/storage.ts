import { Router, type IRouter, type Request, type Response } from "express";
import { Readable, pipeline as streamPipeline } from "stream";
import { promisify } from "util";
import path from "path";
import os from "os";
import fs from "fs";
import { randomUUID } from "crypto";
import { getAuth } from "@clerk/express";
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from "@workspace/api-zod";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { ObjectPermission } from "../lib/objectAcl";
import { createGCSUploadStream } from "../lib/storage";

const pipelineAsync = promisify(streamPipeline);

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

/**
 * POST /storage/uploads/chunk
 *
 * Receive one chunk of a multi-part file upload and persist it to a temp
 * directory keyed by the caller's session ID. Each chunk is small (≤ 4 MB)
 * so it passes through the Replit reverse proxy without issue.
 *
 * Required headers:
 *   X-Session-Id    — UUID that groups all chunks for one file
 *   X-Chunk-Index   — 0-based integer position of this chunk
 *   X-Total-Chunks  — total number of chunks the file was split into
 *   X-File-Name     — original filename (used by /assemble for the extension)
 *   Content-Type    — MIME type of the file (forwarded to GCS on assemble)
 */
router.post("/storage/uploads/chunk", async (req: Request, res: Response): Promise<void> => {
  const auth = getAuth(req);
  if (!auth.userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const sessionId = (req.headers["x-session-id"] as string) || "";
  const chunkIndex = parseInt((req.headers["x-chunk-index"] as string) || "0", 10);
  const totalChunks = parseInt((req.headers["x-total-chunks"] as string) || "1", 10);
  const fileName = (req.headers["x-file-name"] as string) || "upload.mp4";
  const contentType = (req.headers["content-type"] as string) || "application/octet-stream";

  if (!sessionId || isNaN(chunkIndex) || isNaN(totalChunks)) {
    res.status(400).json({ error: "Missing required upload headers" });
    return;
  }

  try {
    const sessionDir = path.join(os.tmpdir(), "upload-sessions", sessionId);
    await fs.promises.mkdir(sessionDir, { recursive: true });

    // Write meta on first chunk so /assemble has all the info it needs.
    if (chunkIndex === 0) {
      await fs.promises.writeFile(
        path.join(sessionDir, "meta.json"),
        JSON.stringify({ fileName, contentType, totalChunks }),
      );
    }

    const chunkPath = path.join(sessionDir, `chunk-${String(chunkIndex).padStart(8, "0")}`);
    const writeStream = fs.createWriteStream(chunkPath);
    await pipelineAsync(req, writeStream);

    res.json({ ok: true, chunkIndex });
  } catch (err) {
    req.log.error({ err }, "Failed to save upload chunk");
    if (!res.headersSent) res.status(500).json({ error: "Failed to save chunk" });
  }
});

/**
 * POST /storage/uploads/assemble
 *
 * After all chunks have been uploaded via /chunk, call this endpoint to
 * concatenate them and stream the result directly to GCS. Returns the
 * object path that should be passed to the job creation endpoint.
 *
 * Body JSON: { sessionId: string }
 */
router.post("/storage/uploads/assemble", async (req: Request, res: Response): Promise<void> => {
  const auth = getAuth(req);
  if (!auth.userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const { sessionId } = req.body as { sessionId?: string };
  if (!sessionId) {
    res.status(400).json({ error: "sessionId is required" });
    return;
  }

  const sessionDir = path.join(os.tmpdir(), "upload-sessions", sessionId);

  try {
    const metaRaw = await fs.promises.readFile(path.join(sessionDir, "meta.json"), "utf8");
    const meta = JSON.parse(metaRaw) as { fileName: string; contentType: string; totalChunks: number };
    const { fileName, contentType, totalChunks } = meta;

    // Verify all chunks exist before we start streaming.
    for (let i = 0; i < totalChunks; i++) {
      const chunkPath = path.join(sessionDir, `chunk-${String(i).padStart(8, "0")}`);
      await fs.promises.access(chunkPath);
    }

    const ext = path.extname(fileName) || ".mp4";
    const objectKey = `uploads/${randomUUID()}${ext}`;
    const gcsStream = createGCSUploadStream(objectKey, { contentType });

    // Stream each chunk into the single GCS write stream sequentially.
    await new Promise<void>((resolve, reject) => {
      gcsStream.on("error", reject);
      gcsStream.on("finish", resolve);

      (async () => {
        for (let i = 0; i < totalChunks; i++) {
          const chunkPath = path.join(sessionDir, `chunk-${String(i).padStart(8, "0")}`);
          await pipelineAsync(fs.createReadStream(chunkPath), gcsStream, { end: false });
        }
        gcsStream.end();
      })().catch(reject);
    });

    // Clean up temp files after successful upload.
    fs.promises.rm(sessionDir, { recursive: true, force: true }).catch(() => {});

    res.json({ objectPath: `/objects/${objectKey}` });
  } catch (err) {
    req.log.error({ err }, "Failed to assemble upload chunks");
    if (!res.headersSent) res.status(500).json({ error: "Failed to assemble upload" });
    // Best-effort cleanup on error.
    fs.promises.rm(sessionDir, { recursive: true, force: true }).catch(() => {});
  }
});

/**
 * POST /storage/uploads/request-url
 *
 * Request a presigned URL for file upload.
 * The client sends JSON metadata (name, size, contentType) — NOT the file.
 * Then uploads the file directly to the returned presigned URL.
 */
router.post("/storage/uploads/request-url", async (req: Request, res: Response) => {
  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Missing or invalid required fields" });
    return;
  }

  try {
    const { name, size, contentType } = parsed.data;

    const uploadURL = await objectStorageService.getObjectEntityUploadURL();
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);

    res.json(
      RequestUploadUrlResponse.parse({
        uploadURL,
        objectPath,
        metadata: { name, size, contentType },
      }),
    );
  } catch (error) {
    req.log.error({ err: error }, "Error generating upload URL");
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

/**
 * GET /storage/public-objects/*
 *
 * Serve public assets from PUBLIC_OBJECT_SEARCH_PATHS.
 * These are unconditionally public — no authentication or ACL checks.
 * IMPORTANT: Always provide this endpoint when object storage is set up.
 */
router.get("/storage/public-objects/*filePath", async (req: Request, res: Response) => {
  try {
    const raw = req.params.filePath;
    const filePath = Array.isArray(raw) ? raw.join("/") : raw;
    const file = await objectStorageService.searchPublicObject(filePath);
    if (!file) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    const response = await objectStorageService.downloadObject(file);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    req.log.error({ err: error }, "Error serving public object");
    res.status(500).json({ error: "Failed to serve public object" });
  }
});

/**
 * GET /storage/objects/*
 *
 * Serve object entities from PRIVATE_OBJECT_DIR.
 * These are served from a separate path from /public-objects and can optionally
 * be protected with authentication or ACL checks based on the use case.
 */
router.get("/storage/objects/*path", async (req: Request, res: Response) => {
  try {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
    const objectPath = `/objects/${wildcardPath}`;
    const objectFile = await objectStorageService.getObjectEntityFile(objectPath);

    // --- Protected route example (uncomment when using replit-auth) ---
    // if (!req.isAuthenticated()) {
    //   res.status(401).json({ error: "Unauthorized" });
    //   return;
    // }
    // const canAccess = await objectStorageService.canAccessObjectEntity({
    //   userId: req.user.id,
    //   objectFile,
    //   requestedPermission: ObjectPermission.READ,
    // });
    // if (!canAccess) {
    //   res.status(403).json({ error: "Forbidden" });
    //   return;
    // }

    const response = await objectStorageService.downloadObject(objectFile);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      req.log.warn({ err: error }, "Object not found");
      res.status(404).json({ error: "Object not found" });
      return;
    }
    req.log.error({ err: error }, "Error serving object");
    res.status(500).json({ error: "Failed to serve object" });
  }
});

export default router;
