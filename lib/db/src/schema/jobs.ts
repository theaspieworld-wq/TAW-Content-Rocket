import { pgTable, text, serial, timestamp, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email"),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const brandsTable = pgTable("brands", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  logoPath: text("logo_path"),
  voiceStyle: text("voice_style"),
  defaultCta: text("default_cta"),
  appendCtaToCopies: text("append_cta_to_copies").notNull().default("false"),
  introAudioPath: text("intro_audio_path"),
  outroAudioPath: text("outro_audio_path"),
  fontFamily: text("font_family"),
  primaryColor: text("primary_color"),
  secondaryColor: text("secondary_color"),
  website: text("website"),
  exportFolderUrl: text("export_folder_url"),
  shortFormOutroPath: text("short_form_outro_path"),
  carouselEndSlidePath: text("carousel_end_slide_path"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertBrandSchema = createInsertSchema(brandsTable).omit({ id: true, createdAt: true });
export type InsertBrand = z.infer<typeof insertBrandSchema>;
export type Brand = typeof brandsTable.$inferSelect;

export const outrosTable = pgTable("outros", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  filePath: text("file_path").notNull(),
  isDefault: text("is_default").notNull().default("false"),
  position: text("position").notNull().default("end"),
  ctaText: text("cta_text"),
  ctaStartSeconds: text("cta_start_seconds"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertOutroSchema = createInsertSchema(outrosTable).omit({ id: true, createdAt: true });
export type InsertOutro = z.infer<typeof insertOutroSchema>;
export type Outro = typeof outrosTable.$inferSelect;

export const brandOutrosTable = pgTable("brand_outros", {
  id: serial("id").primaryKey(),
  brandId: integer("brand_id").notNull().references(() => brandsTable.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  filePath: text("file_path").notNull(),
  ctaText: text("cta_text"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("brand_outros_brand_id_idx").on(t.brandId)]);

export const insertBrandOutroSchema = createInsertSchema(brandOutrosTable).omit({ id: true, createdAt: true });
export type InsertBrandOutro = z.infer<typeof insertBrandOutroSchema>;
export type BrandOutro = typeof brandOutrosTable.$inferSelect;

export const brandCarouselTemplatesTable = pgTable("brand_carousel_templates", {
  id: serial("id").primaryKey(),
  brandId: integer("brand_id").notNull().references(() => brandsTable.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  filePath: text("file_path").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("brand_carousel_templates_brand_id_idx").on(t.brandId)]);

export const insertBrandCarouselTemplateSchema = createInsertSchema(brandCarouselTemplatesTable).omit({ id: true, createdAt: true });
export type InsertBrandCarouselTemplate = z.infer<typeof insertBrandCarouselTemplateSchema>;
export type BrandCarouselTemplate = typeof brandCarouselTemplatesTable.$inferSelect;

export const brandDocumentsTable = pgTable("brand_documents", {
  id: serial("id").primaryKey(),
  brandId: integer("brand_id").notNull().references(() => brandsTable.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  filePath: text("file_path").notNull(),
  contentText: text("content_text"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("brand_documents_brand_id_idx").on(t.brandId)]);

export const insertBrandDocumentSchema = createInsertSchema(brandDocumentsTable).omit({ id: true, createdAt: true });
export type InsertBrandDocument = z.infer<typeof insertBrandDocumentSchema>;
export type BrandDocument = typeof brandDocumentsTable.$inferSelect;

export const jobsTable = pgTable("jobs", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  youtubeUrl: text("youtube_url").notNull(),
  localFilePath: text("local_file_path"),
  videoTitle: text("video_title"),
  status: text("status").notNull().default("pending"),
  errorMessage: text("error_message"),
  clipCount: integer("clip_count").notNull().default(3),
  clipDurationSeconds: integer("clip_duration_seconds").notNull().default(45),
  clipMode: text("clip_mode").notNull().default("ai"),
  captionsEnabled: text("captions_enabled").notNull().default("true"),
  captionStyle: text("caption_style").notNull().default("classic"),
  showTitle: text("show_title").notNull().default("true"),
  showWatermark: text("show_watermark").notNull().default("true"),
  contentCta: text("content_cta"),
  outroId: integer("outro_id").references(() => outrosTable.id, { onDelete: "set null" }),
  brandId: integer("brand_id").references(() => brandsTable.id, { onDelete: "set null" }),
  brandOutroIds: text("brand_outro_ids"),
  transcript: text("transcript"),
  generatedContent: text("generated_content"),
  manualTranscript: text("manual_transcript"),
  generatePodcast: text("generate_podcast").notNull().default("true"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertJobSchema = createInsertSchema(jobsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertJob = z.infer<typeof insertJobSchema>;
export type Job = typeof jobsTable.$inferSelect;

export const appConfigTable = pgTable("app_config", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const clipsTable = pgTable("clips", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").notNull().references(() => jobsTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  startSeconds: text("start_seconds").notNull(),
  endSeconds: text("end_seconds").notNull(),
  durationSeconds: text("duration_seconds").notNull(),
  filePath: text("file_path"),
  status: text("status").notNull().default("pending"),
  instagramCaption: text("instagram_caption"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertClipSchema = createInsertSchema(clipsTable).omit({ id: true, createdAt: true });
export type InsertClip = z.infer<typeof insertClipSchema>;
export type Clip = typeof clipsTable.$inferSelect;
