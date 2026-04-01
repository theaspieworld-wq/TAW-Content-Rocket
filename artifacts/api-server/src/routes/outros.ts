import { Router, type IRouter } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { db, outrosTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  UpdateOutroParams,
  UpdateOutroBody,
  DeleteOutroParams,
  SetDefaultOutroParams,
} from "@workspace/api-zod";
import { logger } from "../lib/logger";

const OUTROS_DIR = path.join(process.cwd(), "outros");
fs.mkdirSync(OUTROS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, OUTROS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || ".mp4";
    cb(null, `outro_${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
  fileFilter: (_req, file, cb) => {
    const allowed = ["video/mp4", "video/quicktime", "video/x-msvideo", "video/webm"];
    if (allowed.includes(file.mimetype) || file.originalname.match(/\.(mp4|mov|avi|webm|mkv)$/i)) {
      cb(null, true);
    } else {
      cb(new Error("Only video files are allowed"));
    }
  },
});

function outroToJson(o: typeof outrosTable.$inferSelect) {
  return {
    id: o.id,
    name: o.name,
    filePath: o.filePath,
    isDefault: o.isDefault === "true",
    position: o.position,
    ctaText: o.ctaText ?? null,
    ctaStartSeconds: o.ctaStartSeconds ? parseFloat(o.ctaStartSeconds) : null,
    createdAt: o.createdAt.toISOString(),
  };
}

const router: IRouter = Router();

router.get("/outros", async (_req, res): Promise<void> => {
  const outros = await db.select().from(outrosTable).orderBy(outrosTable.createdAt);
  res.json(outros.map(outroToJson));
});

router.post("/outros/upload", upload.single("file"), async (req, res): Promise<void> => {
  if (!req.file) {
    res.status(400).json({ error: "No video file uploaded" });
    return;
  }

  const { name, position, ctaText, ctaStartSeconds } = req.body as Record<string, string>;

  if (!name || name.trim() === "") {
    res.status(400).json({ error: "Outro name is required" });
    return;
  }

  const validPositions = ["beginning", "end"];
  const outroPosition = validPositions.includes(position) ? position : "end";

  const [outro] = await db.insert(outrosTable).values({
    name: name.trim(),
    filePath: req.file.path,
    isDefault: "false",
    position: outroPosition,
    ctaText: ctaText?.trim() || null,
    ctaStartSeconds: ctaStartSeconds ? ctaStartSeconds.toString() : null,
  }).returning();

  req.log.info({ outroId: outro.id }, "Outro uploaded");
  res.status(201).json(outroToJson(outro));
});

router.patch("/outros/:id", async (req, res): Promise<void> => {
  const params = UpdateOutroParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = UpdateOutroBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [existing] = await db.select().from(outrosTable).where(eq(outrosTable.id, params.data.id));
  if (!existing) {
    res.status(404).json({ error: "Outro not found" });
    return;
  }

  const updates: Partial<typeof outrosTable.$inferSelect> = {};
  const d = body.data;
  if (d.name !== undefined) updates.name = d.name;
  if (d.position !== undefined) updates.position = d.position;
  if (d.ctaText !== undefined) updates.ctaText = d.ctaText ?? undefined;
  if (d.ctaStartSeconds !== undefined) updates.ctaStartSeconds = d.ctaStartSeconds !== null ? d.ctaStartSeconds.toString() : undefined;
  if (d.isDefault !== undefined) updates.isDefault = d.isDefault ? "true" : "false";

  const [updated] = await db.update(outrosTable).set(updates).where(eq(outrosTable.id, params.data.id)).returning();
  res.json(outroToJson(updated));
});

router.delete("/outros/:id", async (req, res): Promise<void> => {
  const params = DeleteOutroParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [outro] = await db.delete(outrosTable).where(eq(outrosTable.id, params.data.id)).returning();
  if (!outro) {
    res.status(404).json({ error: "Outro not found" });
    return;
  }

  // Delete file from disk
  try {
    if (fs.existsSync(outro.filePath)) {
      fs.unlinkSync(outro.filePath);
    }
  } catch (e) {
    logger.warn({ e }, "Could not delete outro file");
  }

  res.sendStatus(204);
});

router.post("/outros/:id/set-default", async (req, res): Promise<void> => {
  const params = SetDefaultOutroParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [existing] = await db.select().from(outrosTable).where(eq(outrosTable.id, params.data.id));
  if (!existing) {
    res.status(404).json({ error: "Outro not found" });
    return;
  }

  // Clear all defaults first, then set this one
  await db.update(outrosTable).set({ isDefault: "false" });
  const [updated] = await db.update(outrosTable).set({ isDefault: "true" }).where(eq(outrosTable.id, params.data.id)).returning();

  res.json(outroToJson(updated));
});

export default router;
