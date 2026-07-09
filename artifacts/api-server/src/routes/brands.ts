import { Router, type IRouter } from "express";
import multer from "multer";
import path from "path";
import { db, brandsTable, brandOutrosTable, brandDocumentsTable, brandCarouselTemplatesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import {
  CreateBrandBody,
  UpdateBrandParams,
  UpdateBrandBody,
  DeleteBrandParams,
} from "@workspace/api-zod";
import { logger } from "../lib/logger";
import { uploadBuffer, deleteObject, streamToResponse } from "../lib/storage";

const router: IRouter = Router();

const memoryStorage = multer.memoryStorage();

const uploadLogo = multer({
  storage: memoryStorage,
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
  storage: memoryStorage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("audio/") || file.originalname.match(/\.(mp3|wav|aac|m4a|ogg)$/i)) {
      cb(null, true);
    } else {
      cb(new Error("Only audio files are allowed"));
    }
  },
});

const uploadVideo = multer({
  storage: memoryStorage,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("video/") || file.originalname.match(/\.(mp4|mov|webm|avi|mkv)$/i)) {
      cb(null, true);
    } else {
      cb(new Error("Only video files are allowed"));
    }
  },
});

const uploadDocument = multer({
  storage: memoryStorage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.originalname.match(/\.(txt|md|pdf|docx|doc)$/i) || file.mimetype === "text/plain" || file.mimetype === "application/pdf") {
      cb(null, true);
    } else {
      cb(new Error("Only text, PDF, or Word documents are allowed"));
    }
  },
});

function objectKeyFor(prefix: string, originalname: string, fallbackExt: string): string {
  const ext = path.extname(originalname) || fallbackExt;
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
}

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

function brandCarouselTemplateToJson(t: typeof brandCarouselTemplatesTable.$inferSelect) {
  return {
    id: t.id,
    brandId: t.brandId,
    name: t.name,
    filePath: t.filePath,
    sortOrder: t.sortOrder,
    createdAt: t.createdAt.toISOString(),
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

  const templates = await db.select().from(brandCarouselTemplatesTable)
    .where(eq(brandCarouselTemplatesTable.brandId, brand.id));

  await Promise.all(
    [brand.logoPath, brand.introAudioPath, brand.outroAudioPath, brand.shortFormOutroPath, brand.carouselEndSlidePath, ...templates.map(t => t.filePath)]
      .map((key) => deleteObject(key))
  );

  // brand_outros, brand_documents, and brand_carousel_templates are cascade-deleted by the DB
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
    res.status(404).json({ error: "Brand not found" });
    return;
  }

  const key = objectKeyFor("brands/logo", req.file.originalname, ".png");
  await uploadBuffer(key, req.file.buffer, req.file.mimetype);
  await deleteObject(brand.logoPath);

  const [updated] = await db.update(brandsTable)
    .set({ logoPath: key })
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
    res.status(404).json({ error: "Brand not found" });
    return;
  }

  const key = objectKeyFor("brands/audio", req.file.originalname, ".mp3");
  await uploadBuffer(key, req.file.buffer, req.file.mimetype);
  await deleteObject(brand.introAudioPath);

  const [updated] = await db.update(brandsTable)
    .set({ introAudioPath: key })
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
    res.status(404).json({ error: "Brand not found" });
    return;
  }

  const key = objectKeyFor("brands/audio", req.file.originalname, ".mp3");
  await uploadBuffer(key, req.file.buffer, req.file.mimetype);
  await deleteObject(brand.outroAudioPath);

  const [updated] = await db.update(brandsTable)
    .set({ outroAudioPath: key })
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
    res.status(404).json({ error: "Brand not found" });
    return;
  }

  const key = objectKeyFor("brands/video", req.file.originalname, ".mp4");
  await uploadBuffer(key, req.file.buffer, req.file.mimetype);
  await deleteObject(brand.shortFormOutroPath);

  const [updated] = await db.update(brandsTable)
    .set({ shortFormOutroPath: key })
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
    res.status(404).json({ error: "Brand not found" });
    return;
  }

  const key = objectKeyFor("brands/logo", req.file.originalname, ".png");
  await uploadBuffer(key, req.file.buffer, req.file.mimetype);
  await deleteObject(brand.carouselEndSlidePath);

  const [updated] = await db.update(brandsTable)
    .set({ carouselEndSlidePath: key })
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
  if (!brand || !brand.logoPath) {
    res.status(404).json({ error: "Logo not found" });
    return;
  }

  const found = await streamToResponse(brand.logoPath, res, { cacheControl: "public, max-age=86400" });
  if (!found) res.status(404).json({ error: "Logo not found" });
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
    res.status(404).json({ error: "Brand not found" });
    return;
  }

  const name = (req.body?.name as string | undefined) || path.parse(req.file.originalname).name;
  const ctaText = (req.body?.ctaText as string | undefined) || null;

  const key = objectKeyFor("brand-outros/outro", req.file.originalname, ".mp4");
  await uploadBuffer(key, req.file.buffer, req.file.mimetype);

  const existingCount = await db.$count(brandOutrosTable, eq(brandOutrosTable.brandId, id));

  const [outro] = await db.insert(brandOutrosTable).values({
    brandId: id,
    userId,
    name,
    filePath: key,
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

  await deleteObject(outro.filePath);

  await db.delete(brandOutrosTable).where(eq(brandOutrosTable.id, outroId));
  res.status(204).send();
});

// ── Brand Carousel Templates ─────────────────────────────────────────────────

router.get("/brands/:id/carousel-templates", async (req, res): Promise<void> => {
  const userId = getAuth(req).userId!;
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid brand ID" }); return; }

  const [brand] = await db.select().from(brandsTable)
    .where(and(eq(brandsTable.id, id), eq(brandsTable.userId, userId)));
  if (!brand) { res.status(404).json({ error: "Brand not found" }); return; }

  const templates = await db.select().from(brandCarouselTemplatesTable)
    .where(eq(brandCarouselTemplatesTable.brandId, id))
    .orderBy(brandCarouselTemplatesTable.sortOrder, brandCarouselTemplatesTable.createdAt);

  res.json(templates.map(brandCarouselTemplateToJson));
});

router.post("/brands/:id/carousel-templates", uploadLogo.single("file"), async (req, res): Promise<void> => {
  const userId = getAuth(req).userId!;
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid brand ID" }); return; }
  if (!req.file) { res.status(400).json({ error: "No image file provided" }); return; }

  const [brand] = await db.select().from(brandsTable)
    .where(and(eq(brandsTable.id, id), eq(brandsTable.userId, userId)));
  if (!brand) {
    res.status(404).json({ error: "Brand not found" });
    return;
  }

  const name = (req.body?.name as string | undefined) || path.parse(req.file.originalname).name;
  const key = objectKeyFor("brands/carousel-template", req.file.originalname, ".png");
  await uploadBuffer(key, req.file.buffer, req.file.mimetype);

  const existingCount = await db.$count(brandCarouselTemplatesTable, eq(brandCarouselTemplatesTable.brandId, id));

  const [template] = await db.insert(brandCarouselTemplatesTable).values({
    brandId: id,
    userId,
    name,
    filePath: key,
    sortOrder: existingCount,
  }).returning();

  res.status(201).json(brandCarouselTemplateToJson(template));
});

router.get("/brands/:id/carousel-templates/:templateId/image", async (req, res): Promise<void> => {
  const userId = getAuth(req).userId!;
  const id = parseInt(req.params.id, 10);
  const templateId = parseInt(req.params.templateId, 10);
  if (isNaN(id) || isNaN(templateId)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [template] = await db.select().from(brandCarouselTemplatesTable)
    .where(and(eq(brandCarouselTemplatesTable.id, templateId), eq(brandCarouselTemplatesTable.brandId, id), eq(brandCarouselTemplatesTable.userId, userId)));
  if (!template) { res.status(404).json({ error: "Brand carousel template not found" }); return; }

  const found = await streamToResponse(template.filePath, res, { cacheControl: "public, max-age=86400" });
  if (!found) res.status(404).json({ error: "Image not found" });
});

router.delete("/brands/:id/carousel-templates/:templateId", async (req, res): Promise<void> => {
  const userId = getAuth(req).userId!;
  const id = parseInt(req.params.id, 10);
  const templateId = parseInt(req.params.templateId, 10);
  if (isNaN(id) || isNaN(templateId)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [template] = await db.select().from(brandCarouselTemplatesTable)
    .where(and(eq(brandCarouselTemplatesTable.id, templateId), eq(brandCarouselTemplatesTable.brandId, id), eq(brandCarouselTemplatesTable.userId, userId)));
  if (!template) { res.status(404).json({ error: "Brand carousel template not found" }); return; }

  await deleteObject(template.filePath);

  await db.delete(brandCarouselTemplatesTable).where(eq(brandCarouselTemplatesTable.id, templateId));
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
    res.status(404).json({ error: "Brand not found" });
    return;
  }

  const name = path.parse(req.file.originalname).name;

  // Extract text content for plain text / markdown files so the AI can use it
  let contentText: string | null = null;
  try {
    const ext = path.extname(req.file.originalname).toLowerCase();
    if ([".txt", ".md"].includes(ext)) {
      contentText = req.file.buffer.toString("utf-8").slice(0, 20000);
    }
    // PDF / docx extraction could be added here in future
  } catch (e) {
    logger.warn({ e }, "Could not extract text from brand document");
  }

  const key = objectKeyFor("brand-documents/doc", req.file.originalname, ".txt");
  await uploadBuffer(key, req.file.buffer, req.file.mimetype);

  const [doc] = await db.insert(brandDocumentsTable).values({
    brandId: id,
    userId,
    name,
    filePath: key,
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

  await deleteObject(doc.filePath);

  await db.delete(brandDocumentsTable).where(eq(brandDocumentsTable.id, docId));
  res.status(204).send();
});

export default router;
