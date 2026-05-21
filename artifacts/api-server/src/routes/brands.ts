import { Router, type IRouter } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { db, brandsTable, brandOutrosTable, brandDocumentsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import {
  CreateBrandBody,
  UpdateBrandParams,
  UpdateBrandBody,
  DeleteBrandParams,
} from "@workspace/api-zod";
import { logger } from "../lib/logger";

const BRANDS_DIR = path.join(process.cwd(), "brands");
fs.mkdirSync(BRANDS_DIR, { recursive: true });

const router: IRouter = Router();

const logoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, BRANDS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || ".png";
    cb(null, `logo_${Date.now()}${ext}`);
  },
});

const audioStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, BRANDS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || ".mp3";
    cb(null, `audio_${Date.now()}${ext}`);
  },
});

const uploadLogo = multer({
  storage: logoStorage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/") || file.originalname.match(/\.(png|jpg|jpeg|svg|webp)$/i)) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed for logos"));
    }
  },
});

const uploadAudio = multer({
  storage: audioStorage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("audio/") || file.originalname.match(/\.(mp3|wav|aac|m4a|ogg)$/i)) {
      cb(null, true);
    } else {
      cb(new Error("Only audio files are allowed"));
    }
  },
});

const videoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, BRANDS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || ".mp4";
    cb(null, `video_${Date.now()}${ext}`);
  },
});

const uploadVideo = multer({
  storage: videoStorage,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("video/") || file.originalname.match(/\.(mp4|mov|webm|avi|mkv)$/i)) {
      cb(null, true);
    } else {
      cb(new Error("Only video files are allowed"));
    }
  },
});

const documentStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, BRANDS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || ".txt";
    cb(null, `doc_${Date.now()}${ext}`);
  },
});

const uploadDocument = multer({
  storage: documentStorage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.originalname.match(/\.(txt|md|pdf|docx|doc)$/i) || file.mimetype === "text/plain" || file.mimetype === "application/pdf") {
      cb(null, true);
    } else {
      cb(new Error("Only text, PDF, or Word documents are allowed"));
    }
  },
});

function brandToJson(b: typeof brandsTable.$inferSelect) {
  return {
    id: b.id,
    name: b.name,
    logoPath: b.logoPath ?? null,
    voiceStyle: b.voiceStyle ?? null,
    defaultCta: b.defaultCta ?? null,
    appendCtaToCopies: b.appendCtaToCopies === "true",
    introAudioPath: b.introAudioPath ?? null,
    outroAudioPath: b.outroAudioPath ?? null,
    fontFamily: b.fontFamily ?? null,
    primaryColor: b.primaryColor ?? null,
    secondaryColor: b.secondaryColor ?? null,
    website: b.website ?? null,
    exportFolderUrl: b.exportFolderUrl ?? null,
    shortFormOutroPath: b.shortFormOutroPath ?? null,
    carouselEndSlidePath: b.carouselEndSlidePath ?? null,
    createdAt: b.createdAt.toISOString(),
  };
}

function brandOutroToJson(o: typeof brandOutrosTable.$inferSelect) {
  return {
    id: o.id,
    brandId: o.brandId,
    name: o.name,
    filePath: o.filePath,
    ctaText: o.ctaText ?? null,
    sortOrder: o.sortOrder,
    createdAt: o.createdAt.toISOString(),
  };
}

function brandDocumentToJson(d: typeof brandDocumentsTable.$inferSelect) {
  return {
    id: d.id,
    brandId: d.brandId,
    name: d.name,
    filePath: d.filePath,
    contentText: d.contentText ?? null,
    createdAt: d.createdAt.toISOString(),
  };
}

router.get("/brands", async (req, res): Promise<void> => {
  const userId = getAuth(req).userId!;
  const brands = await db.select().from(brandsTable)
    .where(eq(brandsTable.userId, userId))
    .orderBy(brandsTable.createdAt);
  res.json(brands.map(brandToJson));
});

router.post("/brands", async (req, res): Promise<void> => {
  const userId = getAuth(req).userId!;
  const parsed = CreateBrandBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [brand] = await db.insert(brandsTable).values({
    userId,
    name: parsed.data.name,
    voiceStyle: parsed.data.voiceStyle ?? null,
    defaultCta: parsed.data.defaultCta ?? null,
    appendCtaToCopies: parsed.data.appendCtaToCopies ? "true" : "false",
    fontFamily: parsed.data.fontFamily ?? null,
    primaryColor: parsed.data.primaryColor ?? null,
    secondaryColor: parsed.data.secondaryColor ?? null,
    website: parsed.data.website ?? null,
    exportFolderUrl: parsed.data.exportFolderUrl ?? null,
  }).returning();

  res.status(201).json(brandToJson(brand));
});

router.patch("/brands/:id", async (req, res): Promise<void> => {
  const userId = getAuth(req).userId!;
  const params = UpdateBrandParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = UpdateBrandBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [brand] = await db.select().from(brandsTable)
    .where(and(eq(brandsTable.id, params.data.id), eq(brandsTable.userId, userId)));
  if (!brand) {
    res.status(404).json({ error: "Brand not found" });
    return;
  }

  const [updated] = await db.update(brandsTable).set({
    ...(body.data.name !== undefined ? { name: body.data.name } : {}),
    ...(body.data.voiceStyle !== undefined ? { voiceStyle: body.data.voiceStyle } : {}),
    ...(body.data.defaultCta !== undefined ? { defaultCta: body.data.defaultCta } : {}),
    ...(body.data.appendCtaToCopies !== undefined ? { appendCtaToCopies: body.data.appendCtaToCopies ? "true" : "false" } : {}),
    ...(body.data.fontFamily !== undefined ? { fontFamily: body.data.fontFamily } : {}),
    ...(body.data.primaryColor !== undefined ? { primaryColor: body.data.primaryColor } : {}),
    ...(body.data.secondaryColor !== undefined ? { secondaryColor: body.data.secondaryColor } : {}),
    ...(body.data.website !== undefined ? { website: body.data.website } : {}),
    ...(body.data.exportFolderUrl !== undefined ? { exportFolderUrl: body.data.exportFolderUrl } : {}),
  }).where(and(eq(brandsTable.id, params.data.id), eq(brandsTable.userId, userId))).returning();

  res.json(brandToJson(updated));
});

router.delete("/brands/:id", async (req, res): Promise<void> => {
  const userId = getAuth(req).userId!;
  const params = DeleteBrandParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [brand] = await db.select().from(brandsTable)
    .where(and(eq(brandsTable.id, params.data.id), eq(brandsTable.userId, userId)));
  if (!brand) {
    res.status(404).json({ error: "Brand not found" });
    return;
  }

  for (const filePath of [brand.logoPath, brand.introAudioPath, brand.outroAudioPath, brand.shortFormOutroPath, brand.carouselEndSlidePath]) {
    if (filePath && fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch (e) { logger.warn({ e }, "Could not delete brand file"); }
    }
  }

  // brand_outros and brand_documents are cascade-deleted by the DB
  await db.delete(brandsTable)
    .where(and(eq(brandsTable.id, params.data.id), eq(brandsTable.userId, userId)));
  res.status(204).send();
});

router.post("/brands/:id/logo", uploadLogo.single("file"), async (req, res): Promise<void> => {
  const userId = getAuth(req).userId!;
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid brand ID" }); return; }
  if (!req.file) { res.status(400).json({ error: "No logo file provided" }); return; }

  const [brand] = await db.select().from(brandsTable)
    .where(and(eq(brandsTable.id, id), eq(brandsTable.userId, userId)));
  if (!brand) {
    fs.unlinkSync(req.file.path);
    res.status(404).json({ error: "Brand not found" });
    return;
  }

  if (brand.logoPath && fs.existsSync(brand.logoPath)) {
    try { fs.unlinkSync(brand.logoPath); } catch (_) {}
  }

  const [updated] = await db.update(brandsTable)
    .set({ logoPath: req.file.path })
    .where(and(eq(brandsTable.id, id), eq(brandsTable.userId, userId)))
    .returning();

  res.json(brandToJson(updated));
});

router.post("/brands/:id/intro-audio", uploadAudio.single("file"), async (req, res): Promise<void> => {
  const userId = getAuth(req).userId!;
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid brand ID" }); return; }
  if (!req.file) { res.status(400).json({ error: "No audio file provided" }); return; }

  const [brand] = await db.select().from(brandsTable)
    .where(and(eq(brandsTable.id, id), eq(brandsTable.userId, userId)));
  if (!brand) {
    fs.unlinkSync(req.file.path);
    res.status(404).json({ error: "Brand not found" });
    return;
  }

  if (brand.introAudioPath && fs.existsSync(brand.introAudioPath)) {
    try { fs.unlinkSync(brand.introAudioPath); } catch (_) {}
  }

  const [updated] = await db.update(brandsTable)
    .set({ introAudioPath: req.file.path })
    .where(and(eq(brandsTable.id, id), eq(brandsTable.userId, userId)))
    .returning();

  res.json(brandToJson(updated));
});

router.post("/brands/:id/outro-audio", uploadAudio.single("file"), async (req, res): Promise<void> => {
  const userId = getAuth(req).userId!;
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid brand ID" }); return; }
  if (!req.file) { res.status(400).json({ error: "No audio file provided" }); return; }

  const [brand] = await db.select().from(brandsTable)
    .where(and(eq(brandsTable.id, id), eq(brandsTable.userId, userId)));
  if (!brand) {
    fs.unlinkSync(req.file.path);
    res.status(404).json({ error: "Brand not found" });
    return;
  }

  if (brand.outroAudioPath && fs.existsSync(brand.outroAudioPath)) {
    try { fs.unlinkSync(brand.outroAudioPath); } catch (_) {}
  }

  const [updated] = await db.update(brandsTable)
    .set({ outroAudioPath: req.file.path })
    .where(and(eq(brandsTable.id, id), eq(brandsTable.userId, userId)))
    .returning();

  res.json(brandToJson(updated));
});

router.post("/brands/:id/short-form-outro", uploadVideo.single("file"), async (req, res): Promise<void> => {
  const userId = getAuth(req).userId!;
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid brand ID" }); return; }
  if (!req.file) { res.status(400).json({ error: "No video file provided" }); return; }

  const [brand] = await db.select().from(brandsTable)
    .where(and(eq(brandsTable.id, id), eq(brandsTable.userId, userId)));
  if (!brand) {
    fs.unlinkSync(req.file.path);
    res.status(404).json({ error: "Brand not found" });
    return;
  }

  if (brand.shortFormOutroPath && fs.existsSync(brand.shortFormOutroPath)) {
    try { fs.unlinkSync(brand.shortFormOutroPath); } catch (_) {}
  }

  const [updated] = await db.update(brandsTable)
    .set({ shortFormOutroPath: req.file.path })
    .where(and(eq(brandsTable.id, id), eq(brandsTable.userId, userId)))
    .returning();

  res.json(brandToJson(updated));
});

router.post("/brands/:id/carousel-end-slide", uploadLogo.single("file"), async (req, res): Promise<void> => {
  const userId = getAuth(req).userId!;
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid brand ID" }); return; }
  if (!req.file) { res.status(400).json({ error: "No image file provided" }); return; }

  const [brand] = await db.select().from(brandsTable)
    .where(and(eq(brandsTable.id, id), eq(brandsTable.userId, userId)));
  if (!brand) {
    fs.unlinkSync(req.file.path);
    res.status(404).json({ error: "Brand not found" });
    return;
  }

  if (brand.carouselEndSlidePath && fs.existsSync(brand.carouselEndSlidePath)) {
    try { fs.unlinkSync(brand.carouselEndSlidePath); } catch (_) {}
  }

  const [updated] = await db.update(brandsTable)
    .set({ carouselEndSlidePath: req.file.path })
    .where(and(eq(brandsTable.id, id), eq(brandsTable.userId, userId)))
    .returning();

  res.json(brandToJson(updated));
});

router.get("/brands/:id/logo", async (req, res): Promise<void> => {
  const userId = getAuth(req).userId!;
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid brand ID" }); return; }

  const [brand] = await db.select().from(brandsTable)
    .where(and(eq(brandsTable.id, id), eq(brandsTable.userId, userId)));
  if (!brand || !brand.logoPath || !fs.existsSync(brand.logoPath)) {
    res.status(404).json({ error: "Logo not found" });
    return;
  }

  res.sendFile(path.resolve(brand.logoPath));
});

// ── Brand Outros ─────────────────────────────────────────────────────────────

router.get("/brands/:id/outros", async (req, res): Promise<void> => {
  const userId = getAuth(req).userId!;
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid brand ID" }); return; }

  const [brand] = await db.select().from(brandsTable)
    .where(and(eq(brandsTable.id, id), eq(brandsTable.userId, userId)));
  if (!brand) { res.status(404).json({ error: "Brand not found" }); return; }

  const outros = await db.select().from(brandOutrosTable)
    .where(eq(brandOutrosTable.brandId, id))
    .orderBy(brandOutrosTable.sortOrder, brandOutrosTable.createdAt);

  res.json(outros.map(brandOutroToJson));
});

router.post("/brands/:id/outros", uploadVideo.single("file"), async (req, res): Promise<void> => {
  const userId = getAuth(req).userId!;
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid brand ID" }); return; }
  if (!req.file) { res.status(400).json({ error: "No video file provided" }); return; }

  const [brand] = await db.select().from(brandsTable)
    .where(and(eq(brandsTable.id, id), eq(brandsTable.userId, userId)));
  if (!brand) {
    fs.unlinkSync(req.file.path);
    res.status(404).json({ error: "Brand not found" });
    return;
  }

  const name = (req.body?.name as string | undefined) || path.parse(req.file.originalname).name;
  const ctaText = (req.body?.ctaText as string | undefined) || null;

  const existingCount = await db.$count(brandOutrosTable, eq(brandOutrosTable.brandId, id));

  const [outro] = await db.insert(brandOutrosTable).values({
    brandId: id,
    userId,
    name,
    filePath: req.file.path,
    ctaText,
    sortOrder: existingCount,
  }).returning();

  res.status(201).json(brandOutroToJson(outro));
});

router.patch("/brands/:id/outros/:outroId", async (req, res): Promise<void> => {
  const userId = getAuth(req).userId!;
  const id = parseInt(req.params.id, 10);
  const outroId = parseInt(req.params.outroId, 10);
  if (isNaN(id) || isNaN(outroId)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [outro] = await db.select().from(brandOutrosTable)
    .where(and(eq(brandOutrosTable.id, outroId), eq(brandOutrosTable.brandId, id), eq(brandOutrosTable.userId, userId)));
  if (!outro) { res.status(404).json({ error: "Brand outro not found" }); return; }

  const { name, ctaText } = req.body as { name?: string; ctaText?: string | null };
  const [updated] = await db.update(brandOutrosTable).set({
    ...(name !== undefined ? { name } : {}),
    ...(ctaText !== undefined ? { ctaText: ctaText ?? null } : {}),
  }).where(eq(brandOutrosTable.id, outroId)).returning();

  res.json(brandOutroToJson(updated));
});

router.delete("/brands/:id/outros/:outroId", async (req, res): Promise<void> => {
  const userId = getAuth(req).userId!;
  const id = parseInt(req.params.id, 10);
  const outroId = parseInt(req.params.outroId, 10);
  if (isNaN(id) || isNaN(outroId)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [outro] = await db.select().from(brandOutrosTable)
    .where(and(eq(brandOutrosTable.id, outroId), eq(brandOutrosTable.brandId, id), eq(brandOutrosTable.userId, userId)));
  if (!outro) { res.status(404).json({ error: "Brand outro not found" }); return; }

  if (outro.filePath && fs.existsSync(outro.filePath)) {
    try { fs.unlinkSync(outro.filePath); } catch (e) { logger.warn({ e }, "Could not delete brand outro file"); }
  }

  await db.delete(brandOutrosTable).where(eq(brandOutrosTable.id, outroId));
  res.status(204).send();
});

// ── Brand Documents ───────────────────────────────────────────────────────────

router.get("/brands/:id/documents", async (req, res): Promise<void> => {
  const userId = getAuth(req).userId!;
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid brand ID" }); return; }

  const [brand] = await db.select().from(brandsTable)
    .where(and(eq(brandsTable.id, id), eq(brandsTable.userId, userId)));
  if (!brand) { res.status(404).json({ error: "Brand not found" }); return; }

  const docs = await db.select().from(brandDocumentsTable)
    .where(eq(brandDocumentsTable.brandId, id))
    .orderBy(brandDocumentsTable.createdAt);

  res.json(docs.map(brandDocumentToJson));
});

router.post("/brands/:id/documents", uploadDocument.single("file"), async (req, res): Promise<void> => {
  const userId = getAuth(req).userId!;
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid brand ID" }); return; }
  if (!req.file) { res.status(400).json({ error: "No document file provided" }); return; }

  const [brand] = await db.select().from(brandsTable)
    .where(and(eq(brandsTable.id, id), eq(brandsTable.userId, userId)));
  if (!brand) {
    fs.unlinkSync(req.file.path);
    res.status(404).json({ error: "Brand not found" });
    return;
  }

  const name = path.parse(req.file.originalname).name;

  // Extract text content for plain text / markdown files so the AI can use it
  let contentText: string | null = null;
  try {
    const ext = path.extname(req.file.originalname).toLowerCase();
    if ([".txt", ".md"].includes(ext)) {
      contentText = fs.readFileSync(req.file.path, "utf-8").slice(0, 20000);
    }
    // PDF / docx extraction could be added here in future
  } catch (e) {
    logger.warn({ e }, "Could not extract text from brand document");
  }

  const [doc] = await db.insert(brandDocumentsTable).values({
    brandId: id,
    userId,
    name,
    filePath: req.file.path,
    contentText,
  }).returning();

  res.status(201).json(brandDocumentToJson(doc));
});

router.delete("/brands/:id/documents/:docId", async (req, res): Promise<void> => {
  const userId = getAuth(req).userId!;
  const id = parseInt(req.params.id, 10);
  const docId = parseInt(req.params.docId, 10);
  if (isNaN(id) || isNaN(docId)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [doc] = await db.select().from(brandDocumentsTable)
    .where(and(eq(brandDocumentsTable.id, docId), eq(brandDocumentsTable.brandId, id), eq(brandDocumentsTable.userId, userId)));
  if (!doc) { res.status(404).json({ error: "Brand document not found" }); return; }

  if (doc.filePath && fs.existsSync(doc.filePath)) {
    try { fs.unlinkSync(doc.filePath); } catch (e) { logger.warn({ e }, "Could not delete brand document file"); }
  }

  await db.delete(brandDocumentsTable).where(eq(brandDocumentsTable.id, docId));
  res.status(204).send();
});

export default router;
