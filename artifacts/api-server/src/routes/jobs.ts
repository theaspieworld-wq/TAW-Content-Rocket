import { Router, type IRouter } from "express";
import path from "path";
import fs from "fs";
import os from "os";
import archiver from "archiver";
import multer from "multer";
import { db, jobsTable, clipsTable, outrosTable, brandsTable, brandCarouselTemplatesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import {
  CreateJobBody,
  GetJobParams,
  DeleteJobParams,
  DownloadClipParams,
} from "@workspace/api-zod";
import { processJob, generateContent, generatePodcastAudio, regenerateQuoteCards } from "../lib/processor";
import { objectExists, deleteObject, streamToResponse, streamRangeToResponse, getReadStream } from "../lib/storage";

const router: IRouter = Router();
const UPLOADS_DIR = path.join(process.cwd(), "uploads");
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const videoUploadStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || ".mp4";
    cb(null, `upload_${Date.now()}${ext}`);
  },
});

const THUMBNAILS_DIR = path.join(process.cwd(), "uploads", "thumbnails");
fs.mkdirSync(THUMBNAILS_DIR, { recursive: true });

// Accepts a video file ("file") and an optional thumbnail image ("thumbnail")
// in the same multipart request.
const uploadVideoAndThumbnailMiddleware = multer({
  storage: multer.diskStorage({
    destination: (_req, file, cb) => cb(null, file.fieldname === "thumbnail" ? THUMBNAILS_DIR : UPLOADS_DIR),
    filename: (_req, file, cb) => {
      if (file.fieldname === "thumbnail") {
        const ext = path.extname(file.originalname) || ".jpg";
        cb(null, `thumb_${Date.now()}${ext}`);
      } else {
        const ext = path.extname(file.originalname) || ".mp4";
        cb(null, `upload_${Date.now()}${ext}`);
      }
    },
  }),
  limits: { fileSize: 6 * 1024 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.fieldname === "thumbnail") {
      if (file.mimetype.startsWith("image/") || /\.(png|jpg|jpeg|webp)$/i.test(file.originalname)) {
        cb(null, true);
      } else {
        cb(new Error("Only image files are allowed for thumbnails"));
      }
    } else {
      const allowed = /\.(mp4|mov|avi|mkv|webm|m4v|wmv|flv|ts|mts)$/i;
      if (file.mimetype.startsWith("video/") || allowed.test(file.originalname)) {
        cb(null, true);
      } else {
        cb(new Error("Only video files are allowed"));
      }
    }
  },
});

async function jobToJson(j: typeof jobsTable.$inferSelect) {
  const facebookKey = `clips/job_${j.id}_facebook.mp4`;
  const podcastKey = `clips/job_${j.id}_podcast.mp3`;
  const [hasFacebookVideo, hasPodcast] = await Promise.all([
    objectExists(facebookKey),
    objectExists(podcastKey),
  ]);
  return {
    id: j.id,
    youtubeUrl: j.youtubeUrl,
    videoTitle: j.videoTitle ?? null,
    status: j.status,
    errorMessage: j.errorMessage ?? null,
    clipCount: j.clipCount,
    clipDurationSeconds: j.clipDurationSeconds ?? 45,
    clipMode: j.clipMode === "chapters" ? "chapters" : "ai",
    captionsEnabled: j.captionsEnabled !== "false",
    captionStyle: j.captionStyle ?? "classic",
    showTitle: j.showTitle !== "false",
    showWatermark: j.showWatermark !== "false",
    contentCta: j.contentCta ?? null,
    outroId: j.outroId ?? null,
    brandId: j.brandId ?? null,
    hasContent: j.generatedContent != null,
    hasFacebookVideo,
    hasPodcast,
    hasThumbnail: !!j.thumbnailPath && fs.existsSync(j.thumbnailPath),
    manualChapters: j.manualChapters ?? null,
    generatePodcast: j.generatePodcast !== "false",
    createdAt: j.createdAt.toISOString(),
    updatedAt: j.updatedAt.toISOString(),
  };
}

router.get("/jobs", async (req, res): Promise<void> => {
  const userId = getAuth(req).userId!;
  const jobs = await db.select().from(jobsTable)
    .where(eq(jobsTable.userId, userId))
    .orderBy(jobsTable.createdAt);
  res.json(await Promise.all(jobs.map(jobToJson)));
});

// Create a transcript-only job — no video is downloaded or rendered, only
// written content is generated from a pasted transcript. For video jobs,
// use POST /jobs/upload instead.
router.post("/jobs", async (req, res): Promise<void> => {
  const userId = getAuth(req).userId!;
  const parsed = CreateJobBody.safeParse(req.body);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    const message = firstIssue?.message ?? "Invalid request";
    res.status(400).json({ error: message });
    return;
  }

  const {
    clipCount,
    clipDurationSeconds,
    clipMode,
    captionsEnabled,
    captionStyle,
    showTitle,
    showWatermark,
    contentCta,
    outroId,
    brandId,
    manualTranscript,
    generatePodcast,
  } = parsed.data;
  const count = clipCount ?? 9;
  const clipDur = clipDurationSeconds ?? 45;

  if (!manualTranscript?.trim()) {
    res.status(400).json({ error: "Please paste a transcript" });
    return;
  }
  const resolvedUrl = "transcript://manual";

  if (outroId != null) {
    const [outro] = await db.select().from(outrosTable)
      .where(and(eq(outrosTable.id, outroId), eq(outrosTable.userId, userId)));
    if (!outro) {
      res.status(400).json({ error: "Specified outro not found" });
      return;
    }
  }

  if (brandId != null) {
    const [brand] = await db.select().from(brandsTable)
      .where(and(eq(brandsTable.id, brandId), eq(brandsTable.userId, userId)));
    if (!brand) {
      res.status(400).json({ error: "Specified brand not found" });
      return;
    }
  }

  const [job] = await db.insert(jobsTable).values({
    userId,
    youtubeUrl: resolvedUrl,
    clipCount: count,
    clipDurationSeconds: clipDur,
    clipMode: clipMode === "chapters" ? "chapters" : "ai",
    captionsEnabled: captionsEnabled === false ? "false" : "true",
    captionStyle: captionStyle ?? "classic",
    showTitle: showTitle === false ? "false" : "true",
    showWatermark: showWatermark === false ? "false" : "true",
    contentCta: contentCta ?? null,
    status: "pending",
    outroId: outroId ?? null,
    brandId: brandId ?? null,
    manualTranscript: manualTranscript ?? null,
    generatePodcast: generatePodcast === false ? "false" : "true",
  }).returning();

  processJob(job.id).catch(() => {});

  res.status(201).json(await jobToJson(job));
});

// Upload a local video file (plus optional thumbnail image) and create a job.
// This is the only way to start a video job — no YouTube/Facebook URL fetching.
router.post(
  "/jobs/upload",
  uploadVideoAndThumbnailMiddleware.fields([{ name: "file", maxCount: 1 }, { name: "thumbnail", maxCount: 1 }]),
  async (req, res): Promise<void> => {
    const userId = getAuth(req).userId!;
    const files = req.files as { [field: string]: Express.Multer.File[] } | undefined;
    const videoFile = files?.file?.[0];
    const thumbnailFile = files?.thumbnail?.[0];

    if (!videoFile) {
      res.status(400).json({ error: "No video file provided" });
      return;
    }

    const clipCount = parseInt(req.body.clipCount ?? "9", 10);
    const clipDur = parseInt(req.body.clipDurationSeconds ?? "45", 10);
    const outroIdRaw = req.body.outroId ? parseInt(req.body.outroId, 10) : null;
    const brandIdRaw = req.body.brandId ? parseInt(req.body.brandId, 10) : null;

    if (outroIdRaw != null) {
      const [outro] = await db.select().from(outrosTable)
        .where(and(eq(outrosTable.id, outroIdRaw), eq(outrosTable.userId, userId)));
      if (!outro) {
        res.status(400).json({ error: "Specified outro not found" });
        return;
      }
    }

    if (brandIdRaw != null) {
      const [brand] = await db.select().from(brandsTable)
        .where(and(eq(brandsTable.id, brandIdRaw), eq(brandsTable.userId, userId)));
      if (!brand) {
        res.status(400).json({ error: "Specified brand not found" });
        return;
      }
    }

    const clipModeRaw = req.body.clipMode === "chapters" ? "chapters" : "ai";
    const captionsEnabledRaw = req.body.captionsEnabled === "false" ? "false" : "true";
    const captionStyleRaw = ["classic", "bold", "boxed", "brand"].includes(req.body.captionStyle) ? req.body.captionStyle : "classic";
    const showTitleRaw = req.body.showTitle === "false" ? "false" : "true";
    const showWatermarkRaw = req.body.showWatermark === "false" ? "false" : "true";

    let manualChaptersRaw: string | null = null;
    if (clipModeRaw === "chapters" && req.body.manualChapters) {
      try {
        const parsedChapters = JSON.parse(req.body.manualChapters) as Array<{ title?: string; start?: number; end?: number }>;
        if (!Array.isArray(parsedChapters) || parsedChapters.length === 0) {
          res.status(400).json({ error: "Chapter mode requires at least one chapter" });
          return;
        }
        manualChaptersRaw = JSON.stringify(parsedChapters);
      } catch {
        res.status(400).json({ error: "Invalid chapters data" });
        return;
      }
    } else if (clipModeRaw === "chapters") {
      res.status(400).json({ error: "Chapter mode requires at least one chapter" });
      return;
    }

    const [job] = await db.insert(jobsTable).values({
      userId,
      youtubeUrl: `upload://${videoFile.originalname}`,
      localFilePath: videoFile.path,
      thumbnailPath: thumbnailFile?.path ?? null,
      manualChapters: manualChaptersRaw,
      userVideoTitle: req.body.userVideoTitle?.trim() || null,
      userVideoDescription: req.body.userVideoDescription?.trim() || null,
      clipCount: isNaN(clipCount) ? 9 : clipCount,
      clipDurationSeconds: isNaN(clipDur) ? 45 : clipDur,
      clipMode: clipModeRaw,
      captionsEnabled: captionsEnabledRaw,
      captionStyle: captionStyleRaw,
      showTitle: showTitleRaw,
      showWatermark: showWatermarkRaw,
      contentCta: req.body.contentCta?.trim() || null,
      status: "pending",
      outroId: outroIdRaw,
      brandId: brandIdRaw,
    }).returning();

    processJob(job.id).catch(() => {});

    res.status(201).json(await jobToJson(job));
  },
);

// Create a job from a video already uploaded directly to object storage
// (via a presigned URL). Body is JSON metadata only — no file bytes.
router.post("/jobs/upload-from-storage", async (req, res): Promise<void> => {
  const userId = getAuth(req).userId!;
  const { videoObjectPath, videoFileName, thumbnailObjectPath } = req.body ?? {};

  if (!videoObjectPath || typeof videoObjectPath !== "string") {
    res.status(400).json({ error: "No uploaded video object path provided" });
    return;
  }

  const clipCount = parseInt(req.body.clipCount ?? "9", 10);
  const clipDur = parseInt(req.body.clipDurationSeconds ?? "45", 10);
  const outroIdRaw = req.body.outroId ? parseInt(req.body.outroId, 10) : null;
  const brandIdRaw = req.body.brandId ? parseInt(req.body.brandId, 10) : null;

  if (outroIdRaw != null) {
    const [outro] = await db.select().from(outrosTable)
      .where(and(eq(outrosTable.id, outroIdRaw), eq(outrosTable.userId, userId)));
    if (!outro) {
      res.status(400).json({ error: "Specified outro not found" });
      return;
    }
  }

  if (brandIdRaw != null) {
    const [brand] = await db.select().from(brandsTable)
      .where(and(eq(brandsTable.id, brandIdRaw), eq(brandsTable.userId, userId)));
    if (!brand) {
      res.status(400).json({ error: "Specified brand not found" });
      return;
    }
  }

  const clipModeRaw = req.body.clipMode === "chapters" ? "chapters" : "ai";
  const captionsEnabledRaw = req.body.captionsEnabled === "false" ? "false" : "true";
  const captionStyleRaw = ["classic", "bold", "boxed", "brand"].includes(req.body.captionStyle) ? req.body.captionStyle : "classic";
  const showTitleRaw = req.body.showTitle === "false" ? "false" : "true";
  const showWatermarkRaw = req.body.showWatermark === "false" ? "false" : "true";

  let manualChaptersRaw: string | null = null;
  if (clipModeRaw === "chapters" && req.body.manualChapters) {
    try {
      const parsedChapters = JSON.parse(req.body.manualChapters) as Array<{ title?: string; start?: number; end?: number }>;
      if (!Array.isArray(parsedChapters) || parsedChapters.length === 0) {
        res.status(400).json({ error: "Chapter mode requires at least one chapter" });
        return;
      }
      manualChaptersRaw = JSON.stringify(parsedChapters);
    } catch {
      res.status(400).json({ error: "Invalid chapters data" });
      return;
    }
  } else if (clipModeRaw === "chapters") {
    res.status(400).json({ error: "Chapter mode requires at least one chapter" });
    return;
  }

  const [job] = await db.insert(jobsTable).values({
    userId,
    youtubeUrl: `upload://${videoFileName || "uploaded-video.mp4"}`,
    videoObjectPath,
    thumbnailObjectPath: thumbnailObjectPath || null,
    manualChapters: manualChaptersRaw,
    userVideoTitle: req.body.userVideoTitle?.trim() || null,
    userVideoDescription: req.body.userVideoDescription?.trim() || null,
    clipCount: isNaN(clipCount) ? 9 : clipCount,
    clipDurationSeconds: isNaN(clipDur) ? 45 : clipDur,
    clipMode: clipModeRaw,
    captionsEnabled: captionsEnabledRaw,
    captionStyle: captionStyleRaw,
    showTitle: showTitleRaw,
    showWatermark: showWatermarkRaw,
    contentCta: req.body.contentCta?.trim() || null,
    status: "pending",
    outroId: outroIdRaw,
    brandId: brandIdRaw,
  }).returning();

  processJob(job.id).catch(() => {});

  res.status(201).json(await jobToJson(job));
});

// Serve an uploaded job thumbnail image — no auth required so that <img> tags
// embedded in generated blog HTML can load the image directly in the browser.
router.get("/jobs/:id/thumbnail", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid job ID" });
    return;
  }

  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, id));
  if (!job || !job.thumbnailPath || !fs.existsSync(job.thumbnailPath)) {
    res.status(404).json({ error: "Thumbnail not found" });
    return;
  }

  res.sendFile(job.thumbnailPath);
});

router.get("/jobs/:id", async (req, res): Promise<void> => {
  const userId = getAuth(req).userId!;
  const params = GetJobParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [job] = await db.select().from(jobsTable)
    .where(and(eq(jobsTable.id, params.data.id), eq(jobsTable.userId, userId)));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  const clips = await db.select().from(clipsTable).where(eq(clipsTable.jobId, job.id));

  res.json({
    ...(await jobToJson(job)),
    clips: clips.map((c) => ({
      id: c.id,
      jobId: c.jobId,
      title: c.title,
      startSeconds: parseFloat(c.startSeconds),
      endSeconds: parseFloat(c.endSeconds),
      durationSeconds: parseFloat(c.durationSeconds),
      filePath: c.filePath ?? null,
      status: c.status,
      instagramCaption: c.instagramCaption ?? null,
      createdAt: c.createdAt.toISOString(),
    })),
  });
});

router.delete("/jobs/:id", async (req, res): Promise<void> => {
  const userId = getAuth(req).userId!;
  const params = DeleteJobParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const clips = await db.select().from(clipsTable)
    .where(eq(clipsTable.jobId, params.data.id));

  const [job] = await db.delete(jobsTable)
    .where(and(eq(jobsTable.id, params.data.id), eq(jobsTable.userId, userId)))
    .returning();
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  for (const clip of clips) {
    if (clip.filePath) {
      await deleteObject(clip.filePath);
    }
  }

  if (job.localFilePath && fs.existsSync(job.localFilePath)) {
    fs.unlink(job.localFilePath, () => {});
  }
  if (job.thumbnailPath && fs.existsSync(job.thumbnailPath)) {
    fs.unlink(job.thumbnailPath, () => {});
  }

  await deleteObject(`clips/job_${job.id}_facebook.mp4`);
  await deleteObject(`clips/job_${job.id}_podcast.mp3`);

  // Carousel slides use an unknown extension and a variable slide count, so
  // check a reasonable range of indices for both .png and .jpg outputs.
  for (let i = 1; i <= 8; i++) {
    await deleteObject(`clips/carousel_${job.id}_${i}.png`);
  }
  await deleteObject(`clips/carousel_${job.id}_end.png`);
  await deleteObject(`clips/carousel_${job.id}_end.jpg`);

  res.sendStatus(204);
});

router.get("/jobs/:id/content", async (req, res): Promise<void> => {
  const userId = getAuth(req).userId!;
  const params = GetJobParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [job] = await db.select().from(jobsTable)
    .where(and(eq(jobsTable.id, params.data.id), eq(jobsTable.userId, userId)));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  if (!job.generatedContent) {
    res.status(404).json({ error: "Content not yet generated for this job" });
    return;
  }

  res.json(JSON.parse(job.generatedContent));
});

router.post("/jobs/:id/content", async (req, res): Promise<void> => {
  const userId = getAuth(req).userId!;
  const params = GetJobParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [job] = await db.select().from(jobsTable)
    .where(and(eq(jobsTable.id, params.data.id), eq(jobsTable.userId, userId)));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  if (!job.transcript) {
    res.status(400).json({ error: "Transcript not available — please process a new job to generate content" });
    return;
  }

  let brand: typeof brandsTable.$inferSelect | null = null;
  if (job.brandId) {
    const [foundBrand] = await db.select().from(brandsTable)
      .where(and(eq(brandsTable.id, job.brandId), eq(brandsTable.userId, userId)));
    if (foundBrand) brand = foundBrand;
  }

  const transcript = JSON.parse(job.transcript);
  const videoTitle = job.videoTitle ?? "Untitled Video";

  let carouselTemplateKeys: string[] = [];
  if (job.brandId) {
    const templates = await db.select().from(brandCarouselTemplatesTable)
      .where(eq(brandCarouselTemplatesTable.brandId, job.brandId))
      .orderBy(brandCarouselTemplatesTable.sortOrder, brandCarouselTemplatesTable.createdAt);
    carouselTemplateKeys = templates.map(t => t.filePath);
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `regen_${job.id}_`));
  let content;
  try {
    content = await generateContent(job.youtubeUrl, videoTitle, transcript, {
      brandVoice: brand?.voiceStyle ?? null,
      contentCta: job.contentCta ?? null,
      brandName: brand?.name ?? null,
      brandWebsite: brand?.website ?? null,
      jobId: job.id,
      brand,
      tempDir,
      carouselTemplates: carouselTemplateKeys,
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  await db.update(jobsTable).set({ generatedContent: JSON.stringify(content) }).where(eq(jobsTable.id, job.id));

  res.json(content);
});

router.post("/jobs/:id/regenerate-quote-cards", async (req, res): Promise<void> => {
  const userId = getAuth(req).userId!;
  const params = GetJobParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const { style } = req.body as { style?: string };
  if (!style || !["classic", "editorial", "bold", "modern"].includes(style)) {
    res.status(400).json({ error: "style must be one of: classic, editorial, bold, modern" });
    return;
  }
  try {
    const updated = await regenerateQuoteCards(params.data.id, style, userId);
    res.json(updated);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.get("/images/:filename", async (req, res): Promise<void> => {
  const { filename } = req.params;
  if (!/^[\w\-]+\.(jpg|jpeg|png)$/i.test(filename)) {
    res.status(400).json({ error: "Invalid filename" });
    return;
  }
  const found = await streamToResponse(`clips/${filename}`, res, {
    contentType: filename.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg",
    cacheControl: "public, max-age=86400",
    inline: true,
  });
  if (!found) {
    res.status(404).json({ error: "Image not found" });
  }
});

router.get("/clips/:clipId/stream", async (req, res): Promise<void> => {
  const userId = getAuth(req).userId!;
  const params = DownloadClipParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [clip] = await db.select().from(clipsTable).where(eq(clipsTable.id, params.data.clipId));
  if (!clip || !clip.filePath) {
    res.status(404).json({ error: "Clip not found or not ready" });
    return;
  }

  const [job] = await db.select().from(jobsTable)
    .where(and(eq(jobsTable.id, clip.jobId), eq(jobsTable.userId, userId)));
  if (!job) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const filename = `${clip.title.replace(/[^a-z0-9]/gi, "_").toLowerCase()}.mp4`;
  const found = await streamRangeToResponse(clip.filePath, req, res, {
    contentType: "video/mp4",
    filename,
  });
  if (!found) {
    res.status(404).json({ error: "Clip file not found" });
  }
});

router.get("/clips/:clipId/download", async (req, res): Promise<void> => {
  const userId = getAuth(req).userId!;
  const params = DownloadClipParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [clip] = await db.select().from(clipsTable).where(eq(clipsTable.id, params.data.clipId));
  if (!clip || !clip.filePath) {
    res.status(404).json({ error: "Clip not found or not ready" });
    return;
  }

  // Verify clip belongs to a job owned by this user
  const [job] = await db.select().from(jobsTable)
    .where(and(eq(jobsTable.id, clip.jobId), eq(jobsTable.userId, userId)));
  if (!job) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const filename = `${clip.title.replace(/[^a-z0-9]/gi, "_").toLowerCase()}.mp4`;
  const found = await streamToResponse(clip.filePath, res, {
    contentType: "video/mp4",
    filename,
  });
  if (!found) {
    res.status(404).json({ error: "Clip file not found" });
  }
});

router.get("/jobs/:id/download-facebook", async (req, res): Promise<void> => {
  const userId = getAuth(req).userId!;
  const params = GetJobParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [job] = await db.select().from(jobsTable)
    .where(and(eq(jobsTable.id, params.data.id), eq(jobsTable.userId, userId)));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  const safeTitle = (job.videoTitle ?? `job_${job.id}`)
    .replace(/[^a-z0-9]/gi, "_").toLowerCase().slice(0, 60);
  const found = await streamToResponse(`clips/job_${job.id}_facebook.mp4`, res, {
    contentType: "video/mp4",
    filename: `${safeTitle}_facebook_1x1.mp4`,
  });
  if (!found) {
    res.status(404).json({ error: "Facebook video not ready yet" });
  }
});

router.get("/jobs/:id/download-podcast", async (req, res): Promise<void> => {
  const userId = getAuth(req).userId!;
  const params = GetJobParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [job] = await db.select().from(jobsTable)
    .where(and(eq(jobsTable.id, params.data.id), eq(jobsTable.userId, userId)));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  const safeTitle = (job.videoTitle ?? `job_${job.id}`)
    .replace(/[^a-z0-9]/gi, "_").toLowerCase().slice(0, 60);
  const found = await streamToResponse(`clips/job_${job.id}_podcast.mp3`, res, {
    contentType: "audio/mpeg",
    filename: `${safeTitle}_podcast.mp3`,
  });
  if (!found) {
    res.status(404).json({ error: "Podcast not ready — it is generated automatically after processing completes" });
  }
});

router.get("/jobs/:id/download-all", async (req, res): Promise<void> => {
  const userId = getAuth(req).userId!;
  const params = GetJobParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [job] = await db.select().from(jobsTable)
    .where(and(eq(jobsTable.id, params.data.id), eq(jobsTable.userId, userId)));
  if (!job || job.status !== "completed") {
    res.status(404).json({ error: "Job not found or not yet completed" });
    return;
  }

  const clips = await db.select().from(clipsTable).where(eq(clipsTable.jobId, job.id));
  const safeTitle = (job.videoTitle ?? `job_${job.id}`)
    .replace(/[^a-z0-9\s]/gi, "").replace(/\s+/g, "_").slice(0, 60) || `job_${job.id}`;

  const content = job.generatedContent ? JSON.parse(job.generatedContent) : null;

  res.setHeader("Content-Disposition", `attachment; filename="${safeTitle}.zip"`);
  res.setHeader("Content-Type", "application/zip");

  const archive = archiver("zip", { zlib: { level: 6 } });
  archive.on("error", (err) => {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  });
  archive.pipe(res);

  const folder = safeTitle;

  const completedClips = clips.filter(c => c.status === "completed" && c.filePath);
  const clipExistChecks = await Promise.all(completedClips.map(c => objectExists(c.filePath)));
  for (let i = 0; i < completedClips.length; i++) {
    if (!clipExistChecks[i]) continue;
    const clip = completedClips[i];
    const clipName = `${clip.title.replace(/[^a-z0-9]/gi, "_").toLowerCase()}.mp4`;
    archive.append(getReadStream(clip.filePath!), { name: `${folder}/shorts/${clipName}` });
  }

  const fbKey = `clips/job_${job.id}_facebook.mp4`;
  if (await objectExists(fbKey)) {
    archive.append(getReadStream(fbKey), { name: `${folder}/facebook_1x1.mp4` });
  }

  const podcastKey = `clips/job_${job.id}_podcast.mp3`;
  if (await objectExists(podcastKey)) {
    archive.append(getReadStream(podcastKey), { name: `${folder}/podcast.mp3` });
  }

  if (content?.carouselImages?.length > 0) {
    for (let i = 0; i < content.carouselImages.length; i++) {
      const imgKey = `clips/${content.carouselImages[i]}`;
      if (await objectExists(imgKey)) {
        archive.append(getReadStream(imgKey), { name: `${folder}/carousel/slide_${i + 1}.png` });
      }
    }
  }

  if (content) {
    if (content.blogPost) {
      archive.append(content.blogPost, { name: `${folder}/content/blog.html` });
    }
    if (content.socialArticle) {
      archive.append(content.socialArticle, { name: `${folder}/content/social_article.html` });
    }
    if (content.newsletterEmail?.subject && content.newsletterEmail?.body) {
      archive.append(`Subject: ${content.newsletterEmail.subject}\n\n`, { name: `${folder}/content/newsletter_subject.txt` });
      archive.append(content.newsletterEmail.body, { name: `${folder}/content/newsletter.html` });
    }
    if (content.threadPosts?.length > 0) {
      const threadText = content.threadPosts
        .map((p: string, i: number) => `Post ${i + 1}:\n${p.replace(/^Post\s+\d+\s*:\s*/i, "").trim()}`)
        .join("\n\n---\n\n");
      archive.append(threadText, { name: `${folder}/content/thread_posts.txt` });
    }
    if (content.quotes?.length > 0) {
      const csvRows = content.quotes.map((q: string, i: number) => {
        const caption = content.instagramCaptions?.[i] ?? "";
        return `"${q.replace(/"/g, '""')}","${caption.replace(/"/g, '""')}"`;
      });
      const csv = `"Quote","Instagram / TikTok Caption"\n${csvRows.join("\n")}`;
      archive.append(csv, { name: `${folder}/content/quotes_and_captions.csv` });
    }
    if (content.carouselCaption) {
      archive.append(content.carouselCaption, { name: `${folder}/content/carousel_caption.txt` });
    }
  }

  await archive.finalize();
});

export default router;
