import { Router, type IRouter } from "express";
import path from "path";
import fs from "fs";
import { db, jobsTable, clipsTable, outrosTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  CreateJobBody,
  GetJobParams,
  DeleteJobParams,
  DownloadClipParams,
} from "@workspace/api-zod";
import { processJob } from "../lib/processor";

const router: IRouter = Router();

function jobToJson(j: typeof jobsTable.$inferSelect) {
  return {
    id: j.id,
    youtubeUrl: j.youtubeUrl,
    videoTitle: j.videoTitle ?? null,
    status: j.status,
    errorMessage: j.errorMessage ?? null,
    clipCount: j.clipCount,
    outroId: j.outroId ?? null,
    createdAt: j.createdAt.toISOString(),
    updatedAt: j.updatedAt.toISOString(),
  };
}

router.get("/jobs", async (_req, res): Promise<void> => {
  const jobs = await db.select().from(jobsTable).orderBy(jobsTable.createdAt);
  res.json(jobs.map(jobToJson));
});

router.post("/jobs", async (req, res): Promise<void> => {
  const parsed = CreateJobBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { youtubeUrl, clipCount, outroId } = parsed.data;
  const count = clipCount ?? 3;

  if (count < 1 || count > 10) {
    res.status(400).json({ error: "clipCount must be between 1 and 10" });
    return;
  }

  // Validate outroId if provided
  if (outroId != null) {
    const [outro] = await db.select().from(outrosTable).where(eq(outrosTable.id, outroId));
    if (!outro) {
      res.status(400).json({ error: "Specified outro not found" });
      return;
    }
  }

  const [job] = await db.insert(jobsTable).values({
    youtubeUrl,
    clipCount: count,
    status: "pending",
    outroId: outroId ?? null,
  }).returning();

  processJob(job.id).catch(() => {});

  res.status(201).json(jobToJson(job));
});

router.get("/jobs/:id", async (req, res): Promise<void> => {
  const params = GetJobParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, params.data.id));
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
      createdAt: c.createdAt.toISOString(),
    })),
  });
});

router.delete("/jobs/:id", async (req, res): Promise<void> => {
  const params = GetJobParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [job] = await db.delete(jobsTable).where(eq(jobsTable.id, params.data.id)).returning();
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  res.sendStatus(204);
});

router.get("/clips/:clipId/download", async (req, res): Promise<void> => {
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

  if (!fs.existsSync(clip.filePath)) {
    res.status(404).json({ error: "Clip file not found on disk" });
    return;
  }

  const filename = `clip_${clip.id}_${clip.title.replace(/[^a-z0-9]/gi, "_").toLowerCase()}.mp4`;
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Type", "video/mp4");

  const stream = fs.createReadStream(clip.filePath);
  stream.pipe(res);
});

export default router;
