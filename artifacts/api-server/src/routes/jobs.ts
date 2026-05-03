import { Router, type IRouter } from "express";
import path from "path";
import fs from "fs";
import archiver from "archiver";
import { db, jobsTable, clipsTable, outrosTable, brandsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import {
  CreateJobBody,
  GetJobParams,
  DeleteJobParams,
  DownloadClipParams,
} from "@workspace/api-zod";
import { processJob, generateContent, generatePodcastAudio } from "../lib/processor";

const router: IRouter = Router();
const CLIPS_DIR = path.join(process.cwd(), "clips");

function jobToJson(j: typeof jobsTable.$inferSelect) {
  const facebookPath = path.join(CLIPS_DIR, `job_${j.id}_facebook.mp4`);
  const podcastPath = path.join(CLIPS_DIR, `job_${j.id}_podcast.mp3`);
  return {
    id: j.id,
    youtubeUrl: j.youtubeUrl,
    videoTitle: j.videoTitle ?? null,
    status: j.status,
    errorMessage: j.errorMessage ?? null,
    clipCount: j.clipCount,
    clipDurationSeconds: j.clipDurationSeconds ?? 45,
    contentCta: j.contentCta ?? null,
    outroId: j.outroId ?? null,
    brandId: j.brandId ?? null,
    hasContent: j.generatedContent != null,
    hasFacebookVideo: fs.existsSync(facebookPath),
    hasPodcast: fs.existsSync(podcastPath),
    createdAt: j.createdAt.toISOString(),
    updatedAt: j.updatedAt.toISOString(),
  };
}

router.get("/jobs", async (req, res): Promise<void> => {
  const userId = getAuth(req).userId!;
  const jobs = await db.select().from(jobsTable)
    .where(eq(jobsTable.userId, userId))
    .orderBy(jobsTable.createdAt);
  res.json(jobs.map(jobToJson));
});

router.post("/jobs", async (req, res): Promise<void> => {
  const userId = getAuth(req).userId!;
  const parsed = CreateJobBody.safeParse(req.body);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    const message = firstIssue?.message ?? "Invalid request";
    res.status(400).json({ error: message });
    return;
  }

  const { youtubeUrl, clipCount, clipDurationSeconds, contentCta, outroId, brandId } = parsed.data;
  const count = clipCount ?? 9;
  const clipDur = clipDurationSeconds ?? 45;

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
    youtubeUrl,
    clipCount: count,
    clipDurationSeconds: clipDur,
    contentCta: contentCta ?? null,
    status: "pending",
    outroId: outroId ?? null,
    brandId: brandId ?? null,
  }).returning();

  processJob(job.id).catch(() => {});

  res.status(201).json(jobToJson(job));
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
    ...jobToJson(job),
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
    if (clip.filePath && fs.existsSync(clip.filePath)) {
      try { fs.unlinkSync(clip.filePath); } catch (_) {}
    }
  }

  const jobFiles = [
    path.join(CLIPS_DIR, `job_${job.id}_facebook.mp4`),
    path.join(CLIPS_DIR, `job_${job.id}_podcast.mp3`),
  ];
  for (const f of jobFiles) {
    if (fs.existsSync(f)) {
      try { fs.unlinkSync(f); } catch (_) {}
    }
  }

  const carouselPattern = new RegExp(`^carousel_${job.id}_\\d+\\.png$`);
  try {
    for (const file of fs.readdirSync(CLIPS_DIR)) {
      if (carouselPattern.test(file)) {
        try { fs.unlinkSync(path.join(CLIPS_DIR, file)); } catch (_) {}
      }
    }
  } catch (_) {}

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

  const content = await generateContent(job.youtubeUrl, videoTitle, transcript, {
    brandVoice: brand?.voiceStyle ?? null,
    contentCta: job.contentCta ?? null,
    brandName: brand?.name ?? null,
    jobId: job.id,
  });

  await db.update(jobsTable).set({ generatedContent: JSON.stringify(content) }).where(eq(jobsTable.id, job.id));

  res.json(content);
});

router.get("/images/:filename", (req, res): void => {
  const { filename } = req.params;
  if (!/^[\w\-]+\.(jpg|jpeg|png)$/i.test(filename)) {
    res.status(400).json({ error: "Invalid filename" });
    return;
  }
  const filePath = path.join(CLIPS_DIR, filename);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "Image not found" });
    return;
  }
  res.setHeader("Content-Type", filename.endsWith(".png") ? "image/png" : "image/jpeg");
  res.setHeader("Cache-Control", "public, max-age=86400");
  fs.createReadStream(filePath).pipe(res);
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

  if (!fs.existsSync(clip.filePath)) {
    res.status(404).json({ error: "Clip file not found on disk" });
    return;
  }

  const filename = `${clip.title.replace(/[^a-z0-9]/gi, "_").toLowerCase()}.mp4`;
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Type", "video/mp4");
  fs.createReadStream(clip.filePath).pipe(res);
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

  const facebookPath = path.join(CLIPS_DIR, `job_${job.id}_facebook.mp4`);
  if (!fs.existsSync(facebookPath)) {
    res.status(404).json({ error: "Facebook video not ready yet" });
    return;
  }

  const safeTitle = (job.videoTitle ?? `job_${job.id}`)
    .replace(/[^a-z0-9]/gi, "_").toLowerCase().slice(0, 60);
  res.setHeader("Content-Disposition", `attachment; filename="${safeTitle}_facebook_1x1.mp4"`);
  res.setHeader("Content-Type", "video/mp4");
  fs.createReadStream(facebookPath).pipe(res);
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

  const podcastPath = path.join(CLIPS_DIR, `job_${job.id}_podcast.mp3`);
  if (!fs.existsSync(podcastPath)) {
    res.status(404).json({ error: "Podcast not ready — it is generated automatically after processing completes" });
    return;
  }

  const safeTitle = (job.videoTitle ?? `job_${job.id}`)
    .replace(/[^a-z0-9]/gi, "_").toLowerCase().slice(0, 60);
  res.setHeader("Content-Disposition", `attachment; filename="${safeTitle}_podcast.mp3"`);
  res.setHeader("Content-Type", "audio/mpeg");
  fs.createReadStream(podcastPath).pipe(res);
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

  const completedClips = clips.filter(c => c.status === "completed" && c.filePath && fs.existsSync(c.filePath));
  if (completedClips.length > 0) {
    for (const clip of completedClips) {
      const clipName = `${clip.title.replace(/[^a-z0-9]/gi, "_").toLowerCase()}.mp4`;
      archive.file(clip.filePath!, { name: `${folder}/shorts/${clipName}` });
    }
  }

  const fbPath = path.join(CLIPS_DIR, `job_${job.id}_facebook.mp4`);
  if (fs.existsSync(fbPath)) {
    archive.file(fbPath, { name: `${folder}/facebook_1x1.mp4` });
  }

  const podcastPath = path.join(CLIPS_DIR, `job_${job.id}_podcast.mp3`);
  if (fs.existsSync(podcastPath)) {
    archive.file(podcastPath, { name: `${folder}/podcast.mp3` });
  }

  if (content?.carouselImages?.length > 0) {
    for (let i = 0; i < content.carouselImages.length; i++) {
      const imgPath = path.join(CLIPS_DIR, content.carouselImages[i]);
      if (fs.existsSync(imgPath)) {
        archive.file(imgPath, { name: `${folder}/carousel/slide_${i + 1}.png` });
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
