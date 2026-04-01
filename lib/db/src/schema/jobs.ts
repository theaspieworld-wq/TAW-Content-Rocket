import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const outrosTable = pgTable("outros", {
  id: serial("id").primaryKey(),
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

export const jobsTable = pgTable("jobs", {
  id: serial("id").primaryKey(),
  youtubeUrl: text("youtube_url").notNull(),
  videoTitle: text("video_title"),
  status: text("status").notNull().default("pending"),
  errorMessage: text("error_message"),
  clipCount: integer("clip_count").notNull().default(3),
  outroId: integer("outro_id").references(() => outrosTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertJobSchema = createInsertSchema(jobsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertJob = z.infer<typeof insertJobSchema>;
export type Job = typeof jobsTable.$inferSelect;

export const clipsTable = pgTable("clips", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").notNull().references(() => jobsTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  startSeconds: text("start_seconds").notNull(),
  endSeconds: text("end_seconds").notNull(),
  durationSeconds: text("duration_seconds").notNull(),
  filePath: text("file_path"),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertClipSchema = createInsertSchema(clipsTable).omit({ id: true, createdAt: true });
export type InsertClip = z.infer<typeof insertClipSchema>;
export type Clip = typeof clipsTable.$inferSelect;
