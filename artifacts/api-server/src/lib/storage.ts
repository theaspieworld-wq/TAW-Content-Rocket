import { Storage } from "@google-cloud/storage";
import type { Request, Response } from "express";
import { logger } from "./logger";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

export const objectStorageClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: {
        type: "json",
        subject_token_field_name: "access_token",
      },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

/**
 * All persistent app files (brand assets, outros, rendered clips, podcasts,
 * carousel images, etc.) are stored server-side in this GCS bucket under
 * PRIVATE_OBJECT_DIR, keyed by a simple relative path we choose (e.g.
 * "brands/logo_123.png", "clips/job_5_podcast.mp3"). This is NOT the
 * presigned-browser-upload flow — all uploads/downloads happen server-side
 * since files originate from multer (server receives them) or ffmpeg
 * (server generates them).
 */
function parsePrivateDir(): { bucketName: string; prefix: string } {
  const dir = process.env.PRIVATE_OBJECT_DIR || "";
  if (!dir) {
    throw new Error(
      "PRIVATE_OBJECT_DIR not set. Object storage must be provisioned before using storage.ts helpers."
    );
  }
  const parts = dir.replace(/^\/+/, "").split("/").filter(Boolean);
  const bucketName = parts[0];
  const prefix = parts.slice(1).join("/");
  return { bucketName, prefix };
}

function resolveObject(relativeKey: string): { bucketName: string; objectName: string } {
  const { bucketName, prefix } = parsePrivateDir();
  const objectName = prefix ? `${prefix}/${relativeKey}` : relativeKey;
  return { bucketName, objectName };
}

export async function uploadBuffer(
  relativeKey: string,
  buffer: Buffer,
  contentType?: string
): Promise<string> {
  const { bucketName, objectName } = resolveObject(relativeKey);
  const file = objectStorageClient.bucket(bucketName).file(objectName);
  await file.save(buffer, { contentType, resumable: false });
  return relativeKey;
}

export async function uploadLocalFile(
  relativeKey: string,
  localPath: string,
  contentType?: string
): Promise<string> {
  const { bucketName, objectName } = resolveObject(relativeKey);
  await objectStorageClient.bucket(bucketName).upload(localPath, {
    destination: objectName,
    contentType,
    resumable: false,
  });
  return relativeKey;
}

export async function downloadToLocalFile(relativeKey: string, destPath: string): Promise<void> {
  const { bucketName, objectName } = resolveObject(relativeKey);
  await objectStorageClient.bucket(bucketName).file(objectName).download({ destination: destPath });
}

export async function objectExists(relativeKey: string | null | undefined): Promise<boolean> {
  if (!relativeKey) return false;
  try {
    const { bucketName, objectName } = resolveObject(relativeKey);
    const [exists] = await objectStorageClient.bucket(bucketName).file(objectName).exists();
    return exists;
  } catch (e) {
    logger.warn({ e, relativeKey }, "Failed to check object existence");
    return false;
  }
}

export async function deleteObject(relativeKey: string | null | undefined): Promise<void> {
  if (!relativeKey) return;
  try {
    const { bucketName, objectName } = resolveObject(relativeKey);
    await objectStorageClient.bucket(bucketName).file(objectName).delete({ ignoreNotFound: true });
  } catch (e) {
    logger.warn({ e, relativeKey }, "Failed to delete object from storage");
  }
}

export function getReadStream(relativeKey: string) {
  const { bucketName, objectName } = resolveObject(relativeKey);
  return objectStorageClient.bucket(bucketName).file(objectName).createReadStream();
}

/**
 * Streams an object to an Express response with HTTP Range request support.
 * Enables video seeking in `<video>` elements.
 * Returns false if the object doesn't exist.
 */
export async function streamRangeToResponse(
  relativeKey: string,
  req: Request,
  res: Response,
  opts: { contentType?: string; filename?: string } = {}
): Promise<boolean> {
  const { bucketName, objectName } = resolveObject(relativeKey);
  const file = objectStorageClient.bucket(bucketName).file(objectName);
  const [exists] = await file.exists();
  if (!exists) return false;

  const [metadata] = await file.getMetadata();
  const fileSize = parseInt(String(metadata.size ?? 0), 10);

  res.setHeader("Accept-Ranges", "bytes");
  if (opts.contentType) res.setHeader("Content-Type", opts.contentType);
  if (opts.filename) {
    res.setHeader("Content-Disposition", `inline; filename="${opts.filename}"`);
  }

  const rangeHeader = req.headers.range;
  if (rangeHeader) {
    const [startStr, endStr] = rangeHeader.replace(/bytes=/, "").split("-");
    const start = parseInt(startStr, 10);
    const end = endStr ? parseInt(endStr, 10) : fileSize - 1;
    const chunkSize = end - start + 1;

    res.status(206);
    res.setHeader("Content-Range", `bytes ${start}-${end}/${fileSize}`);
    res.setHeader("Content-Length", chunkSize);

    return new Promise((resolve) => {
      file
        .createReadStream({ start, end })
        .on("error", (err) => {
          logger.error({ err, relativeKey }, "Range stream error");
          if (!res.headersSent) res.status(500);
          res.end();
          resolve(true);
        })
        .on("end", () => resolve(true))
        .pipe(res);
    });
  } else {
    res.setHeader("Content-Length", fileSize);
    return new Promise((resolve) => {
      file
        .createReadStream()
        .on("error", (err) => {
          logger.error({ err, relativeKey }, "Stream error");
          if (!res.headersSent) res.status(500);
          res.end();
          resolve(true);
        })
        .on("end", () => resolve(true))
        .pipe(res);
    });
  }
}

/** Streams an object directly to an Express response. Returns false if the object doesn't exist. */
export async function streamToResponse(
  relativeKey: string,
  res: Response,
  opts: { contentType?: string; filename?: string; inline?: boolean; cacheControl?: string } = {}
): Promise<boolean> {
  const { bucketName, objectName } = resolveObject(relativeKey);
  const file = objectStorageClient.bucket(bucketName).file(objectName);
  const [exists] = await file.exists();
  if (!exists) return false;

  if (opts.contentType) res.setHeader("Content-Type", opts.contentType);
  if (opts.cacheControl) res.setHeader("Cache-Control", opts.cacheControl);
  if (opts.filename) {
    res.setHeader(
      "Content-Disposition",
      `${opts.inline ? "inline" : "attachment"}; filename="${opts.filename}"`
    );
  }

  return new Promise((resolve) => {
    file
      .createReadStream()
      .on("error", (err) => {
        logger.error({ err, relativeKey }, "Error streaming object to response");
        if (!res.headersSent) res.status(500);
        res.end();
        resolve(true);
      })
      .on("end", () => resolve(true))
      .pipe(res);
  });
}
