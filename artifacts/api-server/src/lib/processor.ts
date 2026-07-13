import { execFile, execFileSync } from "child_process";
import { promisify } from "util";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import os from "os";
import { db, jobsTable, clipsTable, outrosTable, brandsTable, brandOutrosTable, brandDocumentsTable, brandCarouselTemplatesTable } from "@workspace/db";
import { eq, inArray, and } from "drizzle-orm";
import { openai } from "@workspace/integrations-openai-ai-server";
import { logger } from "./logger";
import { downloadToLocalFile, uploadLocalFile, objectExists } from "./storage";
import { ObjectStorageService } from "./objectStorage";

const objectStorageService = new ObjectStorageService();

const execFileAsync = promisify(execFile);

/** Resolve a system binary to its full path so it works in deployed containers
 *  where the Nix runtime bin dir may not be on PATH. */
function resolveBinary(name: string): string {
  // 1. Try which — works if the binary is already on the process PATH
  try {
    const result = execFileSync("which", [name], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    if (result) return result;
  } catch { /* ignore */ }
  // 2. Check standard Nix / Linux locations
  const candidates = [
    `/nix/var/nix/profiles/default/bin/${name}`,
    `/run/current-system/sw/bin/${name}`,
    `/usr/local/bin/${name}`,
    `/usr/bin/${name}`,
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  // 3. Fall back to bare name and let the OS sort it out
  return name;
}

const FFMPEG  = resolveBinary("ffmpeg");
const FFPROBE = resolveBinary("ffprobe");

// In the compiled ESM bundle (dist/index.mjs), import.meta.url is the bundle
// file URL — go up one level to reach the server root regardless of cwd.
const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const FONTS_CACHE_DIR = path.join(SERVER_ROOT, "fonts");
fs.mkdirSync(FONTS_CACHE_DIR, { recursive: true });

const LOGO_PATH = path.join(SERVER_ROOT, "src", "assets", "taw-logo.png");
const POPPINS_BOLD_PATH = path.join(SERVER_ROOT, "src", "assets", "fonts", "Poppins-Bold.ttf");

// Resolve the system fallback font once at startup using fontconfig so the path
// is correct across both the dev Nix environment and the production container.
function resolveSystemFont(): string {
  try {
    const r = execFileSync("fc-match", ["sans-serif:bold", "--format=%{file}"], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 3000,
    }).trim();
    if (r && fs.existsSync(r)) {
      logger.info({ fontPath: r }, "System font resolved via fc-match");
      return r;
    }
  } catch { /* fc-match unavailable */ }
  return "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
}
const DEJAVU_BOLD_PATH = resolveSystemFont();

function hexToFfmpeg(hex: string): string {
  return "0x" + hex.replace(/^#/, "");
}

const NON_GOOGLE_FONTS = new Set(["Gilroy"]);

async function getFontPath(fontFamily: string | null, customFontObjectPath?: string | null): Promise<string> {
  const defaultFont = fs.existsSync(POPPINS_BOLD_PATH) ? POPPINS_BOLD_PATH : DEJAVU_BOLD_PATH;

  if (customFontObjectPath) {
    const safeKey = customFontObjectPath.replace(/[^a-zA-Z0-9._-]/g, "_");
    const cached = path.join(FONTS_CACHE_DIR, `custom_${safeKey}`);
    if (fs.existsSync(cached)) return cached;
    try {
      await downloadToLocalFile(customFontObjectPath, cached);
      logger.info({ customFontObjectPath }, "Custom brand font downloaded and cached");
      return cached;
    } catch (err) {
      logger.warn({ customFontObjectPath, err }, "Failed to download custom brand font, using default");
      return defaultFont;
    }
  }

  if (!fontFamily || fontFamily.toLowerCase() === "poppins") return defaultFont;

  const safe = fontFamily.replace(/[^a-zA-Z0-9 ]/g, "").trim();
  if (!safe) return defaultFont;

  if (NON_GOOGLE_FONTS.has(safe)) {
    logger.warn({ fontFamily }, "Font is not on Google Fonts — upload a custom font file for this brand");
    return defaultFont;
  }

  const filename = `${safe.replace(/ /g, "_")}_700.ttf`;
  const cached = path.join(FONTS_CACHE_DIR, filename);
  if (fs.existsSync(cached)) return cached;

  try {
    const cssUrl = `https://fonts.googleapis.com/css?family=${encodeURIComponent(safe)}:700`;
    const cssRes = await fetch(cssUrl, {
      headers: { "User-Agent": "Mozilla/4.0 (compatible; MSIE 8.0; Windows NT 6.1; Trident/4.0)" },
    });
    const css = await cssRes.text();
    const match = css.match(/src:\s*url\(([^)]+\.ttf)\)/i);
    if (!match) throw new Error(`No TTF URL in Google Fonts response for font: ${fontFamily}`);

    const fontRes = await fetch(match[1]);
    const buf = await fontRes.arrayBuffer();
    fs.writeFileSync(cached, Buffer.from(buf));
    logger.info({ fontFamily }, "Google Font downloaded and cached");
    return cached;
  } catch (err) {
    logger.warn({ fontFamily, err }, "Failed to download Google Font, using default");
    return defaultFont;
  }
}

async function generateSlideBackground(
  slideTitle: string,
  slideBullets: string[],
  primaryColor: string | null,
  tempDir: string,
): Promise<string | null> {
  try {
    const colorHint = primaryColor ? `Use a color palette inspired by the accent color ${primaryColor}.` : "Use rich, deep, cinematic colors.";
    const summary = [slideTitle, ...slideBullets.slice(0, 2)].join(". ");
    const prompt = `A cinematic, high-quality photographic or abstract art background image representing the concept: "${summary}". ${colorHint} No text, no letters, no numbers, no human faces. Dramatic professional photography with depth of field, rich textures, and moody lighting. Suitable as an Instagram carousel slide background.`;

    const response = await openai.images.generate({
      model: "gpt-image-1",
      prompt,
      size: "1024x1024",
      quality: "low",
      n: 1,
    } as Parameters<typeof openai.images.generate>[0]) as { data?: Array<{ b64_json?: string | null }> };

    const base64 = (response.data ?? [])[0]?.b64_json ?? "";
    if (!base64) return null;

    const bgPath = path.join(tempDir, `slide_bg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.png`);
    fs.writeFileSync(bgPath, Buffer.from(base64, "base64"));
    return bgPath;
  } catch (err) {
    logger.warn({ slideTitle, err }, "AI slide background generation failed — using solid background");
    return null;
  }
}

interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

// Convert plain-text transcript into timed segments by estimating timing at
// ~2.5 words per second (150 wpm average speaking pace).
function textToTranscriptSegments(text: string): TranscriptSegment[] {
  const WORDS_PER_SECOND = 2.5;
  const rawSentences = text.match(/[^.!?\n]+[.!?\n]*/g) ?? [text];
  let currentTime = 0;
  return rawSentences
    .map(s => s.trim())
    .filter(s => s.length > 0)
    .map(sentence => {
      const wordCount = sentence.split(/\s+/).filter(Boolean).length;
      const duration = Math.max(0.5, wordCount / WORDS_PER_SECOND);
      const seg: TranscriptSegment = { start: currentTime, end: currentTime + duration, text: sentence };
      currentTime += duration + 0.1;
      return seg;
    });
}

interface ClipSegment {
  title: string;
  startSeconds: number;
  endSeconds: number;
  reasoning: string;
  instagramCaption: string;
}

interface NewsletterEmail {
  subject: string;
  body: string;
}

interface CarouselSlide {
  title: string;
  bullets: string[];
}

export interface GeneratedContent {
  videoTitle: string;
  thumbnailUrl: string;
  youtubeUrl: string;
  blogPost: string;
  threadPosts: string[];
  socialArticle: string;
  newsletterEmail: NewsletterEmail;
  quotes: string[];
  quoteTimestamps: number[];
  quoteImages: string[];
  quoteCardStyle: string;
  instagramCaptions: string[];
  carouselImages: string[];
  carouselCaption: string;
  podcastShowNotes: string;
}

async function updateJobStatus(jobId: number, status: string, extra?: { videoTitle?: string; errorMessage?: string }): Promise<void> {
  await db.update(jobsTable).set({
    status,
    ...(extra?.videoTitle ? { videoTitle: extra.videoTitle } : {}),
    ...(extra?.errorMessage ? { errorMessage: extra.errorMessage } : {}),
  }).where(eq(jobsTable.id, jobId));
}

async function extractAudio(videoPath: string, outputDir: string): Promise<string> {
  const audioPath = path.join(outputDir, "audio.mp3");
  await execFileAsync(FFMPEG, [
    "-i", videoPath, "-vn", "-ar", "16000", "-ac", "1", "-b:a", "64k", audioPath, "-y",
  ], { timeout: 120000 });
  return audioPath;
}

function parseSrtToSegments(srt: string): TranscriptSegment[] {
  const blocks = srt.trim().split(/\n\n+/);
  const segments: TranscriptSegment[] = [];
  for (const block of blocks) {
    const lines = block.trim().split("\n");
    const timeLine = lines.find((l) => /-->/.test(l));
    if (!timeLine) continue;
    const m = timeLine.match(
      /(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/
    );
    if (!m) continue;
    const start = +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000;
    const end   = +m[5] * 3600 + +m[6] * 60 + +m[7] + +m[8] / 1000;
    const timeIdx = lines.findIndex((l) => /-->/.test(l));
    const text = lines.slice(timeIdx + 1).join(" ").replace(/<[^>]+>/g, "").trim();
    if (!text || end <= start) continue;
    segments.push({ start, end, text });
  }
  return segments;
}

async function transcribeAudio(audioPath: string, videoDuration: number): Promise<TranscriptSegment[]> {
  const audioBuffer = fs.readFileSync(audioPath);
  const audioFile = new File([audioBuffer], "audio.mp3", { type: "audio/mp3" });

  try {
    const srtResponse = await openai.audio.transcriptions.create({
      model: "gpt-4o-mini-transcribe",
      file: audioFile,
      response_format: "srt",
    } as Parameters<typeof openai.audio.transcriptions.create>[0]);

    const srtText = typeof srtResponse === "string" ? srtResponse : String(srtResponse);
    const segments = parseSrtToSegments(srtText);
    if (segments.length > 0) {
      logger.info({ count: segments.length }, "Transcription using real SRT timestamps");
      return segments;
    }
  } catch (srtErr) {
    logger.warn({ srtErr }, "SRT format failed — falling back to json + estimation");
  }

  const response = await openai.audio.transcriptions.create({
    model: "gpt-4o-mini-transcribe",
    file: audioFile,
    response_format: "json",
  } as Parameters<typeof openai.audio.transcriptions.create>[0]);

  const rawText: string =
    typeof response === "string"
      ? response
      : ((response as unknown as { text?: string }).text ?? "");

  if (!rawText.trim()) return [];

  const sentences = rawText
    .trim()
    .split(/(?<=[.!?])\s+/)
    .flatMap((s) => {
      if (s.length > 120) {
        return s.split(/,\s+|\s+(?:and|but|so|because|that|which|who)\s+/i).filter(Boolean);
      }
      return [s];
    })
    .map((s) => s.trim())
    .filter(Boolean);

  const totalChars = sentences.reduce((n, s) => n + s.length, 0) || 1;
  const duration = Math.max(1, videoDuration);

  const segments: TranscriptSegment[] = [];
  let elapsed = 0;
  for (const sentence of sentences) {
    const segDuration = (sentence.length / totalChars) * duration;
    segments.push({ start: elapsed, end: elapsed + segDuration, text: sentence });
    elapsed += segDuration;
  }
  return segments;
}

function makeFallbackClips(clipCount: number, videoDuration: number, clipDurationSeconds: number): ClipSegment[] {
  const clipDuration = Math.min(clipDurationSeconds * 2, Math.floor(videoDuration / (clipCount + 1)));
  const step = videoDuration / (clipCount + 1);
  return Array.from({ length: clipCount }, (_, i) => ({
    title: `HIGHLIGHT CLIP ${i + 1}`,
    startSeconds: Math.max(0, step * (i + 1) - clipDuration / 2),
    endSeconds: Math.min(videoDuration, step * (i + 1) + clipDuration / 2),
    reasoning: "Fallback evenly-spaced clip",
    instagramCaption: "",
  }));
}

async function selectBestClips(
  transcript: TranscriptSegment[],
  clipCount: number,
  videoDuration: number,
  clipDurationSeconds: number,
): Promise<ClipSegment[]> {
  if (clipCount === 0) return [];

  const minDur = Math.max(15, Math.round(clipDurationSeconds * 0.7));
  const maxDur = Math.round(clipDurationSeconds * 1.4);

  const transcriptText = transcript
    .map((s) => `[${s.start.toFixed(1)}s - ${s.end.toFixed(1)}s]: ${s.text}`)
    .join("\n");

  const prompt = `You are an expert short-form video editor. Analyze this transcript and select the ${clipCount} best segments for standalone social media clips.

TRANSCRIPT (with timestamps):
${transcriptText}

VIDEO DURATION: ${videoDuration.toFixed(0)} seconds

Requirements:
- Target duration: ${clipDurationSeconds} seconds each (range ${minDur}s–${maxDur}s)
- Self-contained: viewer must understand the clip with zero context from the rest of the video
- High engagement potential: interesting, funny, insightful, emotional, or surprising
- Start and end at natural speech breaks — never cut mid-sentence
- Prefer segments with a clear narrative arc: setup → development → payoff
- Avoid intros/outros, filler, or incomplete thoughts

Return ONLY a valid JSON array with exactly ${clipCount} clips:
[
  {
    "title": "ENGAGING TITLE IN ALL CAPS (5-8 words)",
    "startSeconds": 12.5,
    "endSeconds": 45.0,
    "reasoning": "Why this segment works well",
    "instagramCaption": "Ready-to-post Instagram caption for this specific clip. Hook line (no emoji). 2-3 short punchy paragraphs expanding on the clip's insight in first person. Relatable question for engagement. 6-8 relevant hashtags on their own line. 150-220 words total."
  }
]

Titles must be ALL CAPS, max 8 words, punchy and hook-oriented. Return ONLY the raw JSON array — no markdown, no explanation.`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_completion_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    });

    const content = response.choices[0]?.message?.content || "";
    const arrayMatch = content.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      const parsed = JSON.parse(arrayMatch[0]) as ClipSegment[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }

    const objMatch = content.match(/\{[\s\S]*\}/);
    if (objMatch) {
      const obj = JSON.parse(objMatch[0]) as { clips?: ClipSegment[] };
      if (Array.isArray(obj.clips) && obj.clips.length > 0) return obj.clips;
    }

    logger.warn({ content: content.slice(0, 200) }, "AI returned no clips, using fallback");
  } catch (e) {
    logger.warn({ e }, "AI clip selection failed, using fallback");
  }

  return makeFallbackClips(clipCount, videoDuration, clipDurationSeconds);
}

interface VideoChapter {
  title: string;
  start: number;
  end: number;
}

// Parse the manually-entered chapters JSON stored on the job into
// VideoChapter objects. Manual chapters replace the old YouTube-metadata
// based chapter lookup (this app is upload-only and no longer talks to
// YouTube at all).
function parseManualChapters(manualChaptersJson: string | null | undefined): VideoChapter[] {
  if (!manualChaptersJson) return [];
  try {
    const raw = JSON.parse(manualChaptersJson) as Array<{ title?: string; start?: number; end?: number }>;
    if (!Array.isArray(raw)) return [];
    return raw
      .map((c): VideoChapter => ({
        title: typeof c.title === "string" && c.title.trim() ? c.title.trim() : "Chapter",
        start: Number(c.start) || 0,
        end: Number(c.end) || 0,
      }))
      .filter((c) => c.end > c.start);
  } catch (e) {
    logger.warn({ e }, "Failed to parse manual chapters JSON");
    return [];
  }
}

const MAX_CHAPTER_CLIPS = 12;
const MIN_CHAPTER_DURATION_SECONDS = 5;

// AI-generate per-clip Instagram captions for arbitrary (non-AI-selected) clip
// segments, e.g. clips derived from YouTube chapters.
async function generateInstagramCaptionsForClips(
  clips: Array<{ title: string; startSeconds: number; endSeconds: number }>,
  transcript: TranscriptSegment[],
  options?: { brandVoice?: string | null; contentCta?: string | null },
): Promise<string[]> {
  if (clips.length === 0) return [];

  const brandVoiceNote = options?.brandVoice
    ? `\n\nBRAND VOICE STYLE: ${options.brandVoice}\nApply this voice consistently.`
    : "";
  const ctaNote = options?.contentCta
    ? `\n\nCTA TO APPEND: "${options.contentCta}" — include this as the final call-to-action.`
    : "";

  const clipsWithText = clips.map((c, i) => {
    const text = transcript
      .filter((s) => s.end > c.startSeconds && s.start < c.endSeconds)
      .map((s) => s.text)
      .join(" ")
      .slice(0, 2000);
    return { index: i, title: c.title, text: text || c.title };
  });

  const prompt = `You are a social media copywriter. For each video snippet below, write a ready-to-post Instagram caption.${brandVoiceNote}${ctaNote}

SNIPPETS:
${clipsWithText.map((c) => `[${c.index}] TITLE: ${c.title}\nTRANSCRIPT: ${c.text}`).join("\n\n")}

Return ONLY a valid JSON array of exactly ${clips.length} strings, one caption per snippet, in the same order (index 0 first, index ${clips.length - 1} last). Each caption: hook line (no emoji), 2-3 short punchy first-person paragraphs, a relatable question, then 6-8 relevant hashtags on their own line. 150-220 words total. Return raw JSON only — no markdown fences, no explanation.`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_completion_tokens: 3000,
      messages: [{ role: "user", content: prompt }],
    });
    const content = response.choices[0]?.message?.content || "";
    const arrayMatch = content.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      const parsed = JSON.parse(arrayMatch[0]) as unknown[];
      if (Array.isArray(parsed)) {
        return clips.map((_, i) => (typeof parsed[i] === "string" ? (parsed[i] as string) : ""));
      }
    }
  } catch (e) {
    logger.warn({ e }, "Instagram caption generation for chapter clips failed");
  }
  return clips.map(() => "");
}

// Build one ClipSegment per usable YouTube chapter, with AI-generated
// Instagram captions backfilled per clip.
async function selectClipsFromChapters(
  manualChaptersJson: string | null | undefined,
  transcript: TranscriptSegment[],
  videoDuration: number,
  options: { brandVoice?: string | null; contentCta?: string | null },
): Promise<ClipSegment[]> {
  const chapters = parseManualChapters(manualChaptersJson);
  const usable = chapters
    .filter((c) => c.end - c.start >= MIN_CHAPTER_DURATION_SECONDS && c.start < videoDuration)
    .map((c) => ({ ...c, end: Math.min(c.end, videoDuration) }))
    .slice(0, MAX_CHAPTER_CLIPS);

  if (usable.length === 0) {
    throw new Error("No chapters were provided — add chapter markers or choose AI auto-pick mode instead.");
  }

  const baseSegments: ClipSegment[] = usable.map((c) => ({
    title: c.title.toUpperCase(),
    startSeconds: c.start,
    endSeconds: c.end,
    reasoning: "YouTube chapter",
    instagramCaption: "",
  }));

  const captions = await generateInstagramCaptionsForClips(baseSegments, transcript, options);
  return baseSegments.map((seg, i) => ({ ...seg, instagramCaption: captions[i] || "" }));
}

async function getVideoDuration(videoPath: string): Promise<number> {
  const { stdout } = await execFileAsync(FFPROBE, [
    "-v", "quiet", "-print_format", "json", "-show_format", videoPath,
  ], { timeout: 30000 });
  const info = JSON.parse(stdout);
  return parseFloat(info.format?.duration || "0");
}

const AUTO_THUMBNAILS_DIR = path.join(process.cwd(), "uploads", "thumbnails");
fs.mkdirSync(AUTO_THUMBNAILS_DIR, { recursive: true });

// Grabs a good-looking still frame from the uploaded video to use as the
// blog/email header image when the user did not upload their own thumbnail.
// Picks a timestamp ~25% into the video (skipping intros/black frames at the
// very start) and falls back to the very first frame if the video is very short.
async function extractAutoThumbnail(videoPath: string, videoDuration: number, jobId: number): Promise<string | null> {
  const timestamp = videoDuration > 4 ? Math.min(videoDuration * 0.25, videoDuration - 1) : 0;
  const outputPath = path.join(AUTO_THUMBNAILS_DIR, `auto_${jobId}_${Date.now()}.jpg`);
  try {
    await execFileAsync(FFMPEG, [
      "-ss", String(timestamp), "-i", videoPath, "-frames:v", "1", "-q:v", "2", outputPath, "-y",
    ], { timeout: 30000 });
    if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
      return outputPath;
    }
    return null;
  } catch (e) {
    logger.warn({ e, jobId }, "Failed to auto-extract thumbnail frame from video");
    return null;
  }
}

function escapeFfmpegText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "")
    .replace(/:/g, "\\:")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/,/g, "\\,");
}

function wrapText(text: string, maxCharsPerLine: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if ((current + " " + word).trim().length > maxCharsPerLine) {
      if (current) lines.push(current.trim());
      current = word;
    } else {
      current = (current + " " + word).trim();
    }
  }
  if (current) lines.push(current.trim());
  return lines.length > 0 ? lines : [text];
}

// ── Quote card visual style presets ─────────────────────────────────────────
const QUOTE_CARD_STYLES: Record<string, {
  fontFamily: string | null;
  overlayFull: boolean;
  overlayAlpha: number;
  fontSize: number;
  textYPosition: "center" | "bottom";
  accentBar: boolean;
  quoteMark: boolean;
}> = {
  classic:   { fontFamily: null,               overlayFull: true,  overlayAlpha: 0.55, fontSize: 64, textYPosition: "center", accentBar: true,  quoteMark: true  },
  editorial: { fontFamily: "Playfair Display", overlayFull: false, overlayAlpha: 0.78, fontSize: 56, textYPosition: "bottom", accentBar: false, quoteMark: true  },
  bold:      { fontFamily: "Montserrat",        overlayFull: true,  overlayAlpha: 0.70, fontSize: 72, textYPosition: "center", accentBar: true,  quoteMark: false },
  modern:    { fontFamily: "Inter",             overlayFull: false, overlayAlpha: 0.72, fontSize: 58, textYPosition: "bottom", accentBar: false, quoteMark: false },
};

// Extracts one JPEG frame per carousel slide from the uploaded video,
// distributing timestamps evenly between 15% and 85% of the video duration.
async function extractVideoFramesForSlides(
  jobId: number,
  count: number,
  videoPath: string,
  videoDuration: number,
  tempDir: string,
): Promise<(string | null)[]> {
  return Promise.all(
    Array.from({ length: count }, async (_, i) => {
      const t = videoDuration * (count > 1 ? 0.15 + (i / (count - 1)) * 0.70 : 0.40);
      const framePath = path.join(tempDir, `cs_frame_${jobId}_${i}.jpg`);
      try {
        await execFileAsync(FFMPEG, [
          "-ss", t.toFixed(2), "-i", videoPath, "-frames:v", "1", "-q:v", "2", framePath, "-y",
        ], { timeout: 30000 });
        if (fs.existsSync(framePath) && fs.statSync(framePath).size > 0) return framePath;
        return null;
      } catch (_) { return null; }
    }),
  );
}

// Renders 1:1 (1080×1080) quote card images using video frame screenshots as
// the background, with the quote text overlaid in the chosen visual style.
async function generateQuoteCards(
  jobId: number,
  quotes: string[],
  quoteTimestamps: number[],
  videoPath: string,
  style: string,
  brand: typeof brandsTable.$inferSelect | null,
  tempDir: string,
  videoDuration: number,
): Promise<string[]> {
  const primary = brand?.primaryColor ?? "#f21178";
  const primaryFf = hexToFfmpeg(primary);
  const brandLabel = brand?.name ?? "Content Rocket";

  const styleKey = (style in QUOTE_CARD_STYLES ? style : "classic") as keyof typeof QUOTE_CARD_STYLES;
  const preset = QUOTE_CARD_STYLES[styleKey];
  const fontFile = await getFontPath(preset.fontFamily);

  const results = await Promise.allSettled(
    quotes.map(async (quote, i) => {
      // Clamp timestamp to valid video range
      const rawTs = quoteTimestamps[i] != null
        ? quoteTimestamps[i]
        : videoDuration * (quotes.length > 1 ? 0.15 + (i / (quotes.length - 1)) * 0.70 : 0.40);
      const ts = Math.max(0, Math.min(rawTs, videoDuration - 1));

      // Extract frame at timestamp
      const framePath = path.join(tempDir, `qf_${jobId}_${i}.jpg`);
      await execFileAsync(FFMPEG, [
        "-ss", ts.toFixed(2), "-i", videoPath, "-frames:v", "1", "-q:v", "2", framePath, "-y",
      ], { timeout: 30000 });
      if (!fs.existsSync(framePath) || fs.statSync(framePath).size === 0) {
        throw new Error(`Frame extraction failed for quote ${i}`);
      }

      const lines = wrapText(quote, 28);
      const lineHeight = Math.round(preset.fontSize * 1.35);
      const totalTextH = lines.length * lineHeight;

      const filters: string[] = [
        "scale=1080:1080:force_original_aspect_ratio=increase",
        "crop=1080:1080",
      ];

      // Dark overlay — full canvas or bottom-partial
      if (preset.overlayFull) {
        filters.push(`drawbox=x=0:y=0:w=1080:h=1080:color=black@${preset.overlayAlpha}:t=fill`);
      } else {
        const overlayTop = Math.max(380, 1080 - totalTextH - 200);
        filters.push(`drawbox=x=0:y=${overlayTop}:w=1080:h=${1080 - overlayTop}:color=black@${preset.overlayAlpha}:t=fill`);
      }

      // Text Y starting position
      let textStartY: number;
      if (preset.textYPosition === "center") {
        textStartY = Math.round((1080 - totalTextH) / 2) + (preset.quoteMark ? 35 : 0);
      } else {
        textStartY = 1080 - totalTextH - 100;
      }

      // Decorative open-quote character
      if (preset.quoteMark) {
        const qY = Math.max(20, textStartY - 68);
        filters.push(
          `drawtext=text='"':fontfile=${fontFile}:fontsize=${preset.fontSize + 36}:fontcolor=${primaryFf}@0.9:x=(w-text_w)/2:y=${qY}:shadowx=2:shadowy=2:shadowcolor=black@0.8`,
        );
      }

      // Quote text lines
      lines.forEach((line, j) => {
        filters.push(
          `drawtext=fontfile=${fontFile}:text='${escapeFfmpegText(line)}':fontsize=${preset.fontSize}:fontcolor=white:x=(w-text_w)/2:y=${textStartY + j * lineHeight}:shadowx=3:shadowy=3:shadowcolor=black@0.9`,
        );
      });

      // Left accent bar
      if (preset.accentBar) {
        filters.push(`drawbox=x=0:y=0:w=8:h=1080:color=${primaryFf}@1:t=fill`);
      }

      // Brand label at bottom
      filters.push(
        `drawtext=fontfile=${fontFile}:text='${escapeFfmpegText(brandLabel)}':fontsize=26:fontcolor=${primaryFf}:x=(w-text_w)/2:y=1042:shadowx=1:shadowy=1:shadowcolor=black@0.8`,
      );

      const filename = `quote_card_${jobId}_${i}.jpg`;
      const outputPath = path.join(tempDir, filename);
      await execFileAsync(FFMPEG, [
        "-i", framePath, "-vf", filters.join(","), "-frames:v", "1", "-q:v", "3", outputPath, "-y",
      ], { timeout: 30000 });

      try { fs.unlinkSync(framePath); } catch (_) {}
      await uploadLocalFile(`clips/${filename}`, outputPath, "image/jpeg");
      try { fs.unlinkSync(outputPath); } catch (_) {}

      logger.info({ jobId, i, ts, styleKey }, "Quote card rendered");
      return filename;
    }),
  );

  return results.flatMap(r =>
    r.status === "fulfilled"
      ? [r.value]
      : (logger.warn({ jobId, err: (r as PromiseRejectedResult).reason }, "Quote card render failed — skipping"), []),
  );
}

async function generateCarouselSlides(
  jobId: number,
  slides: CarouselSlide[],
  brand: typeof brandsTable.$inferSelect | null,
  tempDir: string,
  templateKeys: string[] = [],
  videoPath?: string | null,
  videoDuration?: number,
): Promise<string[]> {
  const fontFile = await getFontPath(brand?.fontFamily ?? null, brand?.customFontPath ?? null);
  const primary = brand?.primaryColor ?? "#f21178";
  const secondary = brand?.secondaryColor ?? "#7c3aed";
  const primaryFf = hexToFfmpeg(primary);
  const secondaryFf = hexToFfmpeg(secondary);
  const brandLabel = brand?.name ?? "Content Rocket";

  // Step A: resolve backgrounds — priority order:
  //   1. Brand-uploaded carousel template images (if any are set up)
  //   2. Video frame screenshots (always preferred over AI generation)
  //   3. null → dark gradient fallback rendered by ffmpeg (no AI generation)

  // Pre-extract video frames so they're available as fallback even when
  // brand templates are configured but fail to download.
  let videoBgPaths: (string | null)[] | null = null;
  if (videoPath && videoDuration && videoDuration > 4) {
    try {
      logger.info({ jobId, count: slides.length }, "Extracting video frame screenshots for carousel backgrounds");
      videoBgPaths = await extractVideoFramesForSlides(jobId, slides.length, videoPath, videoDuration, tempDir);
    } catch (e) {
      logger.warn({ jobId, e }, "Video frame extraction failed — will use dark gradient fallback");
    }
  }

  let bgPaths: (string | null)[];
  if (templateKeys.length > 0) {
    const localTemplatePaths = await Promise.all(
      templateKeys.map(async (key, i) => {
        try {
          const ext = path.extname(key) || ".png";
          const localPath = path.join(tempDir, `carousel_template_${jobId}_${i}${ext}`);
          await downloadToLocalFile(key, localPath);
          return localPath;
        } catch (e) {
          logger.warn({ jobId, key, e }, "Failed to download brand carousel template — skipping");
          return null;
        }
      })
    );
    const validTemplates = localTemplatePaths.filter((p): p is string => !!p);
    if (validTemplates.length > 0) {
      bgPaths = slides.map((_, i) => validTemplates[i % validTemplates.length]);
    } else {
      // Templates all failed — fall back to video frames
      bgPaths = videoBgPaths ?? slides.map(() => null);
    }
  } else {
    // No brand templates — always use video frames (null = dark gradient if video unavailable)
    bgPaths = videoBgPaths ?? slides.map(() => null);
  }

  // Step B: render all slides in parallel — each ffmpeg call is fully independent
  const results = await Promise.allSettled(
    slides.map(async (slide, i) => {
      const bgPath = bgPaths[i];
      const filename = `carousel_${jobId}_${i + 1}.png`;
      const outputPath = path.join(tempDir, filename);

      const titleLines = wrapText(slide.title.toUpperCase(), 20);
      const bullets = slide.bullets.slice(0, 4).map(b => wrapText(b, 26)[0] || b);

      const filters: string[] = bgPath
        ? [
            `scale=1080:1080:force_original_aspect_ratio=increase`,
            `crop=1080:1080`,
            `drawbox=x=0:y=0:w=1080:h=1080:color=black@0.55:t=fill`,
          ]
        : [
            `drawbox=x=0:y=0:w=1080:h=1080:color=0x0a0618@1:t=fill`,
            `drawbox=x=0:y=0:w=1080:h=400:color=0x140a28@0.5:t=fill`,
          ];

      filters.push(`drawbox=x=0:y=0:w=10:h=1080:color=${primaryFf}@1:t=fill`);
      filters.push(`drawbox=x=0:y=940:w=1080:h=140:color=black@0.75:t=fill`);
      filters.push(`drawtext=fontfile=${fontFile}:text='${i + 1} / ${slides.length}':fontsize=34:fontcolor=${primaryFf}:x=980:y=50:shadowx=2:shadowy=2:shadowcolor=black@0.8`);

      titleLines.slice(0, 3).forEach((line, j) => {
        filters.push(
          `drawtext=fontfile=${fontFile}:text='${escapeFfmpegText(line)}':fontsize=68:fontcolor=white:x=50:y=${130 + j * 85}:shadowx=3:shadowy=3:shadowcolor=black@0.9`
        );
      });

      const dividerY = 130 + Math.min(titleLines.length, 3) * 85 + 15;
      filters.push(`drawbox=x=50:y=${dividerY}:w=200:h=4:color=${secondaryFf}@1:t=fill`);

      bullets.forEach((bullet, j) => {
        const bulletY = dividerY + 45 + j * 72;
        if (bulletY < 910) {
          filters.push(
            `drawtext=fontfile=${fontFile}:text='${escapeFfmpegText("  " + bullet)}':fontsize=40:fontcolor=white:x=50:y=${bulletY}:shadowx=2:shadowy=2:shadowcolor=black@0.7`
          );
        }
      });

      filters.push(
        `drawtext=fontfile=${fontFile}:text='${escapeFfmpegText(brandLabel)}':fontsize=30:fontcolor=${primaryFf}:x=(w-text_w)/2:y=970:shadowx=1:shadowy=1:shadowcolor=black@0.8`
      );

      const ffmpegArgs = bgPath
        ? ["-i", bgPath, "-vf", filters.join(","), "-frames:v", "1", "-y", outputPath]
        : ["-f", "lavfi", "-i", "color=c=black:s=1080x1080:d=1", "-vf", filters.join(","), "-frames:v", "1", "-y", outputPath];

      await execFileAsync(FFMPEG, ffmpegArgs, { timeout: 30000 });

      if (bgPath && templateKeys.length === 0) {
        try { fs.unlinkSync(bgPath); } catch (_) {}
      }

      await uploadLocalFile(`clips/${filename}`, outputPath, "image/png");
      try { fs.unlinkSync(outputPath); } catch (_) {}

      logger.info({ jobId, slideIndex: i + 1, hasBg: !!bgPath }, "Carousel slide rendered");
      return filename;
    })
  );

  const generated = results.flatMap(r => {
    if (r.status === "fulfilled") return [r.value];
    logger.warn({ jobId, err: (r as PromiseRejectedResult).reason }, "Failed to render carousel slide — skipping");
    return [];
  });

  if (brand?.carouselEndSlidePath && await objectExists(brand.carouselEndSlidePath)) {
    const ext = path.extname(brand.carouselEndSlidePath) || ".png";
    const endSlideFilename = `carousel_${jobId}_end${ext}`;
    const endSlideLocal = path.join(tempDir, endSlideFilename);
    try {
      await downloadToLocalFile(brand.carouselEndSlidePath, endSlideLocal);
      await uploadLocalFile(`clips/${endSlideFilename}`, endSlideLocal, ext === ".png" ? "image/png" : "image/jpeg");
      try { fs.unlinkSync(endSlideLocal); } catch (_) {}
      generated.push(endSlideFilename);
      logger.info({ jobId }, "Appended brand carousel end slide");
    } catch (e) {
      logger.warn({ jobId, e }, "Failed to copy carousel end slide — skipping");
    }
  }

  return generated;
}

export async function generatePodcastAudio(
  jobId: number,
  videoPath: string,
  brand: typeof brandsTable.$inferSelect | null,
): Promise<string | null> {
  const podcastKey = `clips/job_${jobId}_podcast.mp3`;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `podcast_${jobId}_`));
  const podcastLocalPath = path.join(tempDir, `job_${jobId}_podcast.mp3`);

  try {
    let introPath: string | null = null;
    if (brand?.introAudioPath && await objectExists(brand.introAudioPath)) {
      introPath = path.join(tempDir, `intro${path.extname(brand.introAudioPath) || ".mp3"}`);
      await downloadToLocalFile(brand.introAudioPath, introPath);
    }
    let outroPath: string | null = null;
    if (brand?.outroAudioPath && await objectExists(brand.outroAudioPath)) {
      outroPath = path.join(tempDir, `outro${path.extname(brand.outroAudioPath) || ".mp3"}`);
      await downloadToLocalFile(brand.outroAudioPath, outroPath);
    }

    if (!introPath && !outroPath) {
      // Simple extraction — no mixing needed
      await execFileAsync(FFMPEG, [
        "-i", videoPath,
        "-vn",
        "-acodec", "libmp3lame",
        "-b:a", "192k",
        "-ar", "44100",
        "-ac", "2",
        podcastLocalPath, "-y",
      ], { timeout: 600000 });
    } else {
      // Extract main audio first
      const mainAudioPath = path.join(tempDir, "main.mp3");

      await execFileAsync(FFMPEG, [
        "-i", videoPath,
        "-vn",
        "-acodec", "libmp3lame",
        "-b:a", "192k",
        "-ar", "44100",
        "-ac", "2",
        mainAudioPath, "-y",
      ], { timeout: 600000 });

      // Build concat list
      const concatListPath = path.join(tempDir, "concat.txt");
      const parts: string[] = [];
      if (introPath) parts.push(`file '${introPath}'`);
      parts.push(`file '${mainAudioPath}'`);
      if (outroPath) parts.push(`file '${outroPath}'`);
      fs.writeFileSync(concatListPath, parts.join("\n"));

      await execFileAsync(FFMPEG, [
        "-f", "concat",
        "-safe", "0",
        "-i", concatListPath,
        "-acodec", "libmp3lame",
        "-b:a", "192k",
        "-ar", "44100",
        "-ac", "2",
        podcastLocalPath, "-y",
      ], { timeout: 600000 });
    }

    await uploadLocalFile(podcastKey, podcastLocalPath, "audio/mpeg");
    logger.info({ jobId }, "Podcast audio generated");
    return podcastKey;
  } catch (err) {
    logger.warn({ jobId, err }, "Podcast generation failed");
    return null;
  } finally {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
  }
}

interface CaptionStylePreset {
  fontsize: number;
  fontcolor: string;
  borderw: number;
  bordercolor: string;
  box: boolean;
  boxcolor?: string;
  uppercase: boolean;
}

// ── ASS subtitle helpers ─────────────────────────────────────────────────────
// Using an ASS subtitle file + single `subtitles=` filter is dramatically faster
// than chaining N drawtext filters. libass renders O(1) per frame (only the
// currently-visible line), whereas chained drawtext runs all N evaluations every
// frame regardless of the `enable=` condition. For a 30s clip this is the
// difference between 0.06x speed (5-min timeout breach) and ~0.5x speed.

function formatAssTime(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  const cs = Math.round((secs % 1) * 100);
  return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}.${cs.toString().padStart(2, "0")}`;
}

// Convert ffmpeg/CSS color (white, black, 0xRRGGBB, #RRGGBB) to ASS &HAABBGGRR
function toAssColor(color: string, alphaFrac = 0): string {
  const a = Math.round(alphaFrac * 255).toString(16).padStart(2, "0");
  if (color === "white") return `&H${a}FFFFFF`.toUpperCase();
  if (color === "black") return `&H${a}000000`.toUpperCase();
  const hex = color.replace(/^0x/i, "").replace(/^#/, "").padEnd(6, "0");
  const r = hex.slice(0, 2), g = hex.slice(2, 4), b = hex.slice(4, 6);
  return `&H${a}${b}${g}${r}`.toUpperCase();
}

function buildAssFile(
  chunks: CaptionChunk[],
  style: CaptionStylePreset,
  fontName: string,
): string {
  const primaryColor = toAssColor(style.fontcolor);
  const outlineColor = toAssColor(style.bordercolor ?? "black");

  let borderStyle: number, outlineWidth: number, backColor: string;
  if (style.box) {
    const bc = style.boxcolor ?? "black@0.8";
    const [colorPart, alphaStr] = bc.split("@");
    const alpha = alphaStr ? parseFloat(alphaStr) : 0.8;
    backColor = toAssColor(colorPart.trim(), 1 - alpha);
    borderStyle = 3; outlineWidth = 0;
  } else {
    backColor = "&H00000000";
    borderStyle = 1; outlineWidth = style.borderw ?? 3;
  }

  // Place captions at ~72% from top → 28% from bottom = 0.28 × 1920 ≈ 538px MarginV
  const marginV = Math.round(1920 * 0.28);

  const styleRow =
    `Style: Default,${fontName},${style.fontsize},${primaryColor},&H000000FF,` +
    `${outlineColor},${backColor},1,0,0,0,100,100,0,0,${borderStyle},${outlineWidth},0,2,10,10,${marginV},1`;

  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    "PlayResX: 1080",
    "PlayResY: 1920",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    styleRow,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ].join("\n");

  const dialogues = chunks.map((chunk) => {
    const raw = style.uppercase ? chunk.text.toUpperCase() : chunk.text;
    // wrapText gives us lines; join with ASS hard-newline tag
    const assText = wrapText(raw, 22).join("\\N").replace(/\{/g, "\\{");
    return `Dialogue: 0,${formatAssTime(chunk.start)},${formatAssTime(chunk.end)},Default,,0,0,0,,${assText}`;
  });

  return `${header}\n${dialogues.join("\n")}\n`;
}

// 4 default burned-in caption presets — all rendered lower-third, centered.
function getCaptionStyle(style: string | null | undefined, brand: typeof brandsTable.$inferSelect | null): CaptionStylePreset {
  switch (style) {
    case "bold":
      return { fontsize: 62, fontcolor: "0xFFD400", borderw: 5, bordercolor: "black", box: false, uppercase: true };
    case "boxed":
      return { fontsize: 50, fontcolor: "white", borderw: 0, bordercolor: "black", box: true, boxcolor: "black@0.6", uppercase: false };
    case "brand": {
      const brandHex = brand?.primaryColor ? hexToFfmpeg(brand.primaryColor) : "0xf21178";
      return { fontsize: 56, fontcolor: brandHex, borderw: 4, bordercolor: "white", box: false, uppercase: true };
    }
    case "classic":
    default:
      return { fontsize: 54, fontcolor: "white", borderw: 3, bordercolor: "black", box: false, uppercase: false };
  }
}

interface CaptionChunk {
  start: number;
  end: number;
  text: string;
}

// Slice the transcript to the clip's time range, rebase to clip-relative
// timestamps, and split into short (~5 word) burst-caption chunks.
function buildCaptionChunks(transcript: TranscriptSegment[], clipStart: number, clipEnd: number, maxWordsPerChunk = 5): CaptionChunk[] {
  const chunks: CaptionChunk[] = [];
  const clipDuration = clipEnd - clipStart;
  const overlapping = transcript
    .filter((s) => s.end > clipStart && s.start < clipEnd && s.text.trim())
    .sort((a, b) => a.start - b.start);

  for (const seg of overlapping) {
    const segStart = Math.max(seg.start, clipStart);
    const segEnd = Math.min(seg.end, clipEnd);
    if (segEnd <= segStart) continue;
    const segDuration = segEnd - segStart;
    const words = seg.text.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;

    for (let i = 0; i < words.length; i += maxWordsPerChunk) {
      const chunkWords = words.slice(i, i + maxWordsPerChunk);
      const fracStart = i / words.length;
      const fracEnd = Math.min(1, (i + chunkWords.length) / words.length);
      const chunkStart = Math.max(0, segStart + fracStart * segDuration - clipStart);
      const chunkEnd = Math.min(clipDuration, segStart + fracEnd * segDuration - clipStart);
      if (chunkEnd <= chunkStart) continue;
      chunks.push({ start: chunkStart, end: chunkEnd, text: chunkWords.join(" ") });
    }
  }
  return chunks;
}

async function renderMainClip(
  videoPath: string,
  clipId: number,
  title: string,
  startSeconds: number,
  endSeconds: number,
  transcript: TranscriptSegment[],
  outputPath: string,
  options: {
    captionsEnabled: boolean;
    captionStyle: string;
    showTitle: boolean;
    showWatermark: boolean;
    watermarkLocalPath: string | null;
    brand: typeof brandsTable.$inferSelect | null;
  },
): Promise<void> {
  const portraitCrop = "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920";
  const fontFile = await getFontPath(options.brand?.fontFamily ?? null, options.brand?.customFontPath ?? null);
  const filterStages: string[] = [portraitCrop];

  if (options.showTitle && title.trim()) {
    const barColor = options.brand?.primaryColor ? hexToFfmpeg(options.brand.primaryColor) : "black";
    const titleLines = wrapText(title.toUpperCase(), 22).slice(0, 3);
    const barHeight = 70 + titleLines.length * 70;
    filterStages.push(`drawbox=x=0:y=0:w=1080:h=${barHeight}:color=${barColor}@0.88:t=fill`);
    titleLines.forEach((line, i) => {
      filterStages.push(
        `drawtext=fontfile=${fontFile}:text='${escapeFfmpegText(line)}':fontsize=56:fontcolor=white:x=(w-text_w)/2:y=${40 + i * 70}:shadowx=2:shadowy=2:shadowcolor=black@0.8`,
      );
    });
  }

  let assFilePath: string | null = null;

  if (options.captionsEnabled) {
    const style = getCaptionStyle(options.captionStyle, options.brand);
    const clipDuration = endSeconds - startSeconds;

    // Re-transcribe just this clip's audio so captions have accurate 0-based
    // timestamps. The full-video SRT uses sentence-level segments; distributing
    // words evenly within those coarse chunks causes captions to drift badly.
    let captionSegments: TranscriptSegment[] = [];
    const tempClipAudio = outputPath.replace(/\.mp4$/, "_capaud.mp3");
    try {
      await execFileAsync(FFMPEG, [
        "-ss", startSeconds.toString(),
        "-i", videoPath,
        "-t", clipDuration.toString(),
        "-vn", "-ar", "16000", "-ac", "1", "-b:a", "64k",
        tempClipAudio, "-y",
      ], { timeout: 60000 });
      captionSegments = await transcribeAudio(tempClipAudio, clipDuration);
    } catch (captionErr) {
      logger.warn({ captionErr }, "Clip audio transcription failed — falling back to rebased full-video transcript");
      captionSegments = transcript
        .filter((s) => s.end > startSeconds && s.start < endSeconds)
        .map((s) => ({
          start: Math.max(0, s.start - startSeconds),
          end: Math.min(clipDuration, s.end - startSeconds),
          text: s.text,
        }));
    } finally {
      try { fs.unlinkSync(tempClipAudio); } catch (_) {}
    }

    const chunks = buildCaptionChunks(captionSegments, 0, clipDuration);
    if (chunks.length > 0) {
      // Write an ASS subtitle file and use a SINGLE subtitles= filter instead
      // of N chained drawtext filters.  libass evaluates only the currently-visible
      // subtitle per frame (O(1)), while drawtext evaluates ALL N enable= conditions
      // every frame (O(N)) — with 50-100 chunks this was causing 0.06x real-time
      // speed and breaching the 5-minute render timeout.
      const fontName = options.brand?.fontFamily ?? "Poppins";
      assFilePath = outputPath.replace(/\.mp4$/, "_captions.ass");
      fs.writeFileSync(assFilePath, buildAssFile(chunks, style, fontName), "utf-8");
      const fontsDir = path.dirname(fontFile);
      // Escape single quotes and backslashes for lavfi filter string
      const escapedAss = assFilePath.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
      const escapedFontsDir = fontsDir.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
      filterStages.push(`subtitles='${escapedAss}':fontsdir='${escapedFontsDir}'`);
    }
  }

  const useWatermark = options.showWatermark && !!options.watermarkLocalPath;
  const args: string[] = [
    "-ss", startSeconds.toString(),
    "-i", videoPath,
    "-t", (endSeconds - startSeconds).toString(),
  ];

  if (useWatermark) {
    args.push("-loop", "1", "-i", options.watermarkLocalPath as string);
    const filterComplex =
      `[0:v]${filterStages.join(",")}[base];` +
      `[1:v]scale=160:-1[wm];` +
      `[base][wm]overlay=36:36:shortest=1[vout]`;
    args.push("-filter_complex", filterComplex, "-map", "[vout]", "-map", "0:a?");
  } else {
    args.push("-vf", filterStages.join(","));
  }

  args.push(
    "-sn",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
    "-c:a", "aac", "-b:a", "128k",
    "-metadata", `title=${title}`,
    "-movflags", "+faststart",
    outputPath, "-y",
  );

  try {
    await execFileAsync(FFMPEG, args, { timeout: 600000 });
  } finally {
    if (assFilePath) { try { fs.unlinkSync(assFilePath); } catch (_) {} }
  }

  void clipId;
}

function formatSrtTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")},${ms.toString().padStart(3, "0")}`;
}

function transcriptToSrt(transcript: TranscriptSegment[]): string {
  const segs = [...transcript].sort((a, b) => a.start - b.start);
  for (let i = 0; i < segs.length - 1; i++) {
    if (segs[i].end > segs[i + 1].start) segs[i] = { ...segs[i], end: segs[i + 1].start };
  }
  return segs
    .filter((s) => s.end > s.start && s.text.trim())
    .map((seg, i) => {
      const words = seg.text.trim().toUpperCase().split(/\s+/).filter(Boolean);
      const lines: string[] = [];
      let cur = "";
      for (const w of words) {
        if ((cur + " " + w).trim().length > 30) { if (cur) lines.push(cur.trim()); cur = w; }
        else cur = (cur + " " + w).trim();
      }
      if (cur) lines.push(cur.trim());
      return `${i + 1}\n${formatSrtTime(seg.start)} --> ${formatSrtTime(seg.end)}\n${lines.join("\n")}`;
    })
    .join("\n\n") + "\n";
}

async function renderFullFacebookVideo(
  videoPath: string,
  _jobId: number,
  _transcript: TranscriptSegment[],
  outputPath: string,
): Promise<void> {
  const squareCrop = "scale=1080:1080:force_original_aspect_ratio=increase,crop=1080:1080";

  await execFileAsync(FFMPEG, [
    "-i", videoPath,
    "-vf", squareCrop,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
    "-c:a", "aac", "-b:a", "192k",
    "-movflags", "+faststart",
    outputPath, "-y",
  ], { timeout: 3600000 });
}

async function prepareOutroWithCta(
  outroFilePath: string,
  ctaText: string | null,
  ctaStartSeconds: number | null,
  outputPath: string,
): Promise<void> {
  if (!ctaText || ctaText.trim() === "") {
    await execFileAsync(FFMPEG, [
      "-i", outroFilePath,
      "-c:v", "libx264", "-preset", "fast", "-crf", "23",
      "-c:a", "aac", "-b:a", "128k",
      "-movflags", "+faststart",
      outputPath, "-y",
    ], { timeout: 120000 });
    return;
  }

  const startSec = ctaStartSeconds ?? 0;
  const outroText = escapeFfmpegText(ctaText.toUpperCase());
  const ctaFilter = `drawtext=text='${outroText}':fontfile=${DEJAVU_BOLD_PATH}:fontsize=30:fontcolor=white:x=(w-text_w)/2:y=h-th-60:enable='gte(t,${startSec.toFixed(2)})':borderw=3:bordercolor=black@0.8`;

  await execFileAsync(FFMPEG, [
    "-i", outroFilePath,
    "-vf", ctaFilter,
    "-c:v", "libx264", "-preset", "fast", "-crf", "23",
    "-c:a", "aac", "-b:a", "128k",
    "-movflags", "+faststart",
    outputPath, "-y",
  ], { timeout: 120000 });
}

async function concatenateClipWithOutro(
  mainClipPath: string,
  outroPath: string,
  position: string,
  finalOutputPath: string,
  tempDir: string,
  uniqueId: number | string,
): Promise<void> {
  const { stdout } = await execFileAsync(FFPROBE, [
    "-v", "quiet", "-print_format", "json", "-show_streams",
    "-select_streams", "v:0", mainClipPath,
  ], { timeout: 30000 });

  const info = JSON.parse(stdout);
  const stream = info.streams?.[0];
  const width = stream?.width || 1280;
  const height = stream?.height || 720;

  // Use uniqueId in temp filenames to prevent collisions when clips render in parallel
  const scaledOutroPath = path.join(tempDir, `outro_scaled_${uniqueId}.mp4`);
  await execFileAsync(FFMPEG, [
    "-i", outroPath,
    "-vf", `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black`,
    "-c:v", "libx264", "-preset", "fast", "-crf", "23",
    "-c:a", "aac", "-b:a", "128k",
    "-movflags", "+faststart",
    scaledOutroPath, "-y",
  ], { timeout: 120000 });

  const concatListPath = path.join(tempDir, `concat_list_${uniqueId}.txt`);
  const concatContent = position === "beginning"
    ? `file '${scaledOutroPath}'\nfile '${mainClipPath}'\n`
    : `file '${mainClipPath}'\nfile '${scaledOutroPath}'\n`;
  fs.writeFileSync(concatListPath, concatContent);

  await execFileAsync(FFMPEG, [
    "-f", "concat",
    "-safe", "0",
    "-i", concatListPath,
    "-c:v", "libx264", "-preset", "fast", "-crf", "23",
    "-c:a", "aac", "-b:a", "128k",
    "-movflags", "+faststart",
    finalOutputPath, "-y",
  ], { timeout: 300000 });
}

// Unused now that YouTube URL fetching has been removed — retained only if
// legacy jobs still carry a youtubeUrl string that happens to be a real URL.
function extractVideoId(url: string): string | null {
  const patterns = [
    /youtu\.be\/([^?&/#]+)/,
    /[?&]v=([^&/#]+)/,
    /youtube\.com\/embed\/([^?&/#]+)/,
    /youtube\.com\/shorts\/([^?&/#]+)/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

function getThumbnailUrl(youtubeUrl: string): string {
  const videoId = extractVideoId(youtubeUrl);
  return videoId ? `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg` : "";
}

const APP_URL = process.env.REPLIT_DOMAINS
  ? `https://${process.env.REPLIT_DOMAINS.split(",")[0]}`
  : "";

// Builds a public URL for an uploaded job thumbnail (served via the
// GET /api/jobs/:id/thumbnail route), for use in emails / content that
// needs a real fetchable image URL.
function getUploadedThumbnailUrl(jobId: number, hasThumbnail: boolean): string {
  if (!hasThumbnail || !APP_URL) return "";
  return `${APP_URL}/api/jobs/${jobId}/thumbnail`;
}

interface NewsletterSection {
  heading: string;
  body?: string;
  subItems?: Array<{ label: string; description: string }>;
}

function buildNewsletterHtml(params: {
  videoTitle: string;
  thumbnailUrl: string;
  youtubeUrl: string;
  intro: string;
  sections: NewsletterSection[];
  cta: string;
  brandName?: string;
}): string {
  const { videoTitle, thumbnailUrl, youtubeUrl, intro, sections, cta, brandName } = params;

  const sectionsHtml = sections.map((sec) => {
    const subHtml = sec.subItems && sec.subItems.length > 0
      ? `<ul style="padding-left:20px;margin:8px 0 12px">${
          sec.subItems.map((item) =>
            `<li style="margin-bottom:8px"><strong>${item.label}</strong> — ${item.description}</li>`
          ).join("")
        }</ul>`
      : "";
    return [
      `<h2 style="font-size:16px;font-weight:700;margin:24px 0 6px;color:#0d0d0d">${sec.heading}</h2>`,
      sec.body ? `<p style="margin:0 0 6px">${sec.body}</p>` : "",
      subHtml,
    ].join("");
  }).join("");

  const signOff = brandName ? `Dan &amp; The ${brandName} Team` : "Dan &amp; The TAW Media Team";

  return [
    `<div style="max-width:600px;margin:0 auto;font-family:Georgia,serif;color:#1a1a1a;line-height:1.8;font-size:15px">`,
    thumbnailUrl ? `<img src="${thumbnailUrl}" alt="${videoTitle}" style="width:100%;height:auto;margin-bottom:24px;display:block" />` : "",
    `<p style="margin:0 0 14px">Hey!</p>`,
    `<p style="margin:0 0 14px">${intro}</p>`,
    sectionsHtml,
    `<p style="margin:24px 0 14px">${cta}</p>`,
    `<p style="margin:0 0 14px">Watch the full video here: <a href="${youtubeUrl}" style="color:#f21178">${youtubeUrl}</a></p>`,
    `<p style="margin:24px 0 4px">Speak soon,</p>`,
    `<p style="margin:0">${signOff}</p>`,
    `</div>`,
  ].join("");
}

// Sanitize a clip title into a safe, readable filename segment (max 60 chars)
function sanitizeFilename(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60) || "clip";
}

export async function generateContent(
  youtubeUrl: string,
  videoTitle: string,
  transcript: TranscriptSegment[],
  options?: {
    brandVoice?: string | null;
    contentCta?: string | null;
    brandName?: string | null;
    brandWebsite?: string | null;
    brandDocuments?: string[];
    jobId?: number;
    brand?: typeof brandsTable.$inferSelect | null;
    tempDir?: string;
    carouselTemplates?: string[];
    thumbnailUrl?: string | null;
    videoDescription?: string | null;
    videoPath?: string | null;
    videoDuration?: number;
    quoteCardStyle?: string;
  },
): Promise<GeneratedContent> {
  const thumbnailUrl = options?.thumbnailUrl ?? getThumbnailUrl(youtubeUrl);
  // Include timestamps so the AI can reference which seconds each quote comes from
  const transcriptText = transcript
    .map((s) => `[${Math.round(s.start)}s] ${s.text}`)
    .join(" ")
    .slice(0, 12000);
  const jobId = options?.jobId ?? 0;

  const brandVoiceNote = options?.brandVoice
    ? `\n\nBRAND VOICE STYLE: ${options.brandVoice}\nApply this voice consistently across all content.`
    : "";

  const videoDescriptionNote = options?.videoDescription
    ? `\n\nCREATOR-PROVIDED VIDEO DESCRIPTION (extra context on what this video is about — use it to inform accuracy and framing, don't just quote it):\n${options.videoDescription.slice(0, 2000)}`
    : "";

  const brandDocsNote = options?.brandDocuments?.length
    ? `\n\nBRAND REFERENCE DOCUMENTS (use to inform brand voice, terminology, and positioning):\n${options.brandDocuments.join("\n---\n").slice(0, 6000)}`
    : "";

  const ctaNote = options?.contentCta
    ? `\n\nCTA TO APPEND: "${options.contentCta}" — include this as the final call-to-action in all text content pieces.`
    : "";

  // ── Call A: short-form content ──────────────────────────────────────────
  const promptA = `You are a professional content creator. Based on this YouTube video transcript, generate short-form social content.${brandVoiceNote}${videoDescriptionNote}${brandDocsNote}${ctaNote}

VIDEO TITLE: ${videoTitle}
VIDEO URL: ${youtubeUrl}

TRANSCRIPT:
${transcriptText}

Return ONLY a valid JSON object with these exact keys — no markdown fences, no explanation:

{
  "quotes": [
    "Powerful verbatim or near-verbatim quote from the transcript. Max 220 chars. No attribution.",
    "Second quote — different theme or insight. Max 220 chars.",
    "Third quote — emotionally resonant or thought-provoking. Max 220 chars.",
    "Fourth quote — actionable or memorable. Max 220 chars.",
    "Fifth quote — a fresh angle not covered by the above four. Max 220 chars."
  ],
  "quoteTimestamps": [45, 120, 240, 380, 500],
  "instagramCaptions": [
    "Instagram/TikTok caption for Quote 1. Hook line. 3-4 first-person story paragraphs elaborating on the quote using real insights. Open question. 8-10 hashtags on their own line. CTA line. 250-350 words total.",
    "Caption for Quote 2. Same structure. Different angle.",
    "Caption for Quote 3. Same structure. Different angle.",
    "Caption for Quote 4. Same structure. Different angle.",
    "Caption for Quote 5. Same structure. Different angle."
  ],
  "threadPosts": [
    "Hook — the single most compelling insight from the video. Start with the insight, no preamble. Max 280 chars.",
    "Key insight from the video. Start directly with the content. Max 280 chars.",
    "Another insight or tactical tip. Max 280 chars.",
    "Practical action step the viewer can use immediately. Max 280 chars.",
    "Closing post — end with the direct CTA link (no 'comment for' or 'DM me' — paste the link itself): ${options?.contentCta ? options.contentCta : youtubeUrl}. Max 280 chars."
  ],
  "newsletterSubject": "Compelling email subject line. Max 60 chars. No clickbait.",
  "newsletterIntro": "3-4 sentences. Direct, upbeat, conversational — like a mate sharing a great video. Do NOT start with 'Hey' — that is already in the template.",
  "newsletterSections": [
    {
      "heading": "First section heading — the core problem or context from the video",
      "body": "2-3 sentences of substantive insight.",
      "subItems": []
    },
    {
      "heading": "Second section heading — the solution or framework taught in the video",
      "body": "1-2 sentences framing the approach.",
      "subItems": [
        { "label": "Step 1 label", "description": "What this step involves and its specific outcome." },
        { "label": "Step 2 label", "description": "What this step involves and its specific outcome." },
        { "label": "Step 3 label", "description": "What this step involves and its specific outcome." }
      ]
    }
  ],
  "newsletterCta": "2-3 sentences of enthusiastic closing. No button — plain text only.",
  "carouselSlides": [
    { "title": "Slide 1 title — the main insight (max 5 words)", "bullets": ["Concise point 1 (max 7 words)", "Concise point 2 (max 7 words)", "Concise point 3 (max 7 words)"] },
    { "title": "Slide 2 title — second key takeaway", "bullets": ["Point 1", "Point 2", "Point 3"] },
    { "title": "Slide 3 title — third key takeaway", "bullets": ["Point 1", "Point 2", "Point 3"] },
    { "title": "Slide 4 title — actionable final slide", "bullets": ["Point 1", "Point 2", "Point 3"] }
  ],
  "carouselCaption": "Instagram caption for the 4-slide carousel post. Hook line inviting people to swipe. 3-4 paragraphs of insight. Open question. 6-8 hashtags on their own line. CTA. 200-280 words."
}`;

  // ── Call B: long-form content ─────────────────────────────────────────
  const ctaSuffix = options?.contentCta
    ? ` End the post with this call-to-action: "${options.contentCta}".`
    : "";

  const promptB = `You are a professional content creator. Based on this YouTube video transcript, generate long-form written content.${brandVoiceNote}${videoDescriptionNote}

VIDEO TITLE: ${videoTitle}
VIDEO URL: ${youtubeUrl}

TRANSCRIPT:
${transcriptText}

Return ONLY a valid JSON object with these exact keys — no markdown fences, no explanation:

{
  "blogPost": "SEO-OPTIMISED HTML BLOG POST. ALLOWED TAGS: <h1> <h2> <h3> <p> <strong> <em> <ul> <li> only. STRUCTURE: (1) <h1> SEO title. (2) 2-3 <p> hook paragraphs. (3) 6-8 <h2> sections each with 2-3 <p> paragraphs; use <h3> for sub-steps followed by <ul><li>. (4) LAST: <p><strong>TL;DR:</strong> 3-4 sentence summary</p>.${ctaSuffix} TARGET: minimum 1500 words.",
  "socialArticle": "HTML article for Facebook, Quora, LinkedIn. ALLOWED TAGS: <h2> <p> <strong> <em> <ul> <li> only. TARGET: 500 words. STRUCTURE: <p> hook. 2-3 <h2> sections. One <ul><li> list. Final <p> ending with: 'FREE autism life hacks book — link in comments.'",
  "faqItems": [{"question": "FREQUENTLY ASKED QUESTION about the topic", "answer": "CLEAR, HELPFUL ANSWER (2-3 sentences)"}],
  "podcastShowNotes": "SEO-READY PODCAST SHOW NOTES — plain text only, no HTML, no markdown. Use this exact structure with the literal section headers shown:\n\nEPISODE TITLE:\n[Compelling, keyword-rich episode title — 60-70 chars]\n\nEPISODE DESCRIPTION:\n[2-3 sentences. Front-load the primary keyword. Summarise what the listener will learn. 200-280 chars total — this is what appears on Spotify/Apple Podcasts.]\n\nIN THIS EPISODE YOU'LL LEARN:\n• [Specific takeaway 1 — actionable]\n• [Specific takeaway 2 — actionable]\n• [Specific takeaway 3 — actionable]\n• [Specific takeaway 4 — actionable]\n• [Specific takeaway 5 — actionable]\n\nTIMESTAMPS:\n0:00 — Introduction\n[Generate 5-7 realistic timestamp entries based on the transcript flow — e.g. '2:15 — The core problem explained']\n\nRESOURCES & LINKS:${options?.contentCta ? `\n${options.contentCta}` : "\n[Add your website or resource links here]"}\n[Subscribe for more: link in bio]\n\nKEYWORDS:\n[10-12 SEO keywords and phrases from the topic, comma-separated — include long-tail variants]\n\nLIKE THIS EPISODE?\nLeave a review and share with someone who needs to hear this."
}`;

  const [responseA, responseB] = await Promise.all([
    openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: promptA }],
      max_completion_tokens: 8000,
      response_format: { type: "json_object" },
    }),
    openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: promptB }],
      max_completion_tokens: 8000,
      response_format: { type: "json_object" },
    }),
  ]);

  const parseJson = (raw: string): Record<string, unknown> => {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return {};
    try { return JSON.parse(match[0]); } catch { return {}; }
  };

  const a = parseJson(responseA.choices[0]?.message?.content ?? "{}");
  const b = parseJson(responseB.choices[0]?.message?.content ?? "{}");

  // ── Blog post: append FAQ + schema markup ─────────────────────────────
  const rawBlogHtml = (b.blogPost as string) ?? "";
  const faqItems = Array.isArray(b.faqItems)
    ? (b.faqItems as Array<{ question: string; answer: string }>).filter(
        (item) => typeof item?.question === "string" && typeof item?.answer === "string"
      )
    : [];

  const faqHtml = faqItems.length > 0
    ? `\n<h2>Frequently Asked Questions</h2>\n` +
      faqItems.map((item) => `<h3>${item.question}</h3>\n<p>${item.answer}</p>`).join("\n")
    : "";

  const h1Match = rawBlogHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const blogHeadline = h1Match
    ? h1Match[1].replace(/<[^>]+>/g, "").trim()
    : videoTitle;
  const brandName = options?.brandName ?? "TAW Media";
  const brandWebsite = options?.brandWebsite ?? null;

  const schemaGraph: Record<string, unknown>[] = [
    {
      "@type": "Article",
      headline: blogHeadline,
      datePublished: new Date().toISOString().split("T")[0],
      url: brandWebsite ?? youtubeUrl,
      publisher: {
        "@type": "Organization",
        name: brandName,
        ...(brandWebsite ? { url: brandWebsite } : {}),
      },
    },
  ];
  if (faqItems.length > 0) {
    schemaGraph.push({
      "@type": "FAQPage",
      mainEntity: faqItems.map((item) => ({
        "@type": "Question",
        name: item.question,
        acceptedAnswer: { "@type": "Answer", text: item.answer },
      })),
    });
  }
  const schemaScript = `\n<script type="application/ld+json">\n${JSON.stringify(
    { "@context": "https://schema.org", "@graph": schemaGraph },
    null,
    2,
  )}\n</script>`;

  const finalBlogPost = rawBlogHtml + faqHtml + schemaScript;

  const newsletterHtml = buildNewsletterHtml({
    videoTitle,
    thumbnailUrl,
    youtubeUrl,
    intro: (a.newsletterIntro as string) ?? "",
    sections: Array.isArray(a.newsletterSections) ? (a.newsletterSections as NewsletterSection[]) : [],
    cta: (a.newsletterCta as string) ?? "",
    brandName: options?.brandName ?? undefined,
  });

  const quotes = Array.isArray(a.quotes) ? (a.quotes as string[]).slice(0, 5) : [];
  const rawTimestamps = Array.isArray(a.quoteTimestamps) ? (a.quoteTimestamps as number[]) : [];
  const quoteTimestamps = quotes.map((_, i) => typeof rawTimestamps[i] === "number" ? rawTimestamps[i] : 0);

  const tmpDir = options?.tempDir ?? os.tmpdir();

  // Generate carousel images if slides were returned
  let carouselImages: string[] = [];
  const rawSlides = a.carouselSlides;
  if (Array.isArray(rawSlides) && rawSlides.length > 0 && jobId > 0) {
    const slides = (rawSlides as Array<{ title?: string; bullets?: string[] }>).map(s => ({
      title: s.title ?? "Key Insight",
      bullets: Array.isArray(s.bullets) ? s.bullets : [],
    }));
    carouselImages = await generateCarouselSlides(
      jobId, slides, options?.brand ?? null, tmpDir,
      options?.carouselTemplates ?? [],
      options?.videoPath ?? null,
      options?.videoDuration,
    );
  }

  // Generate quote card images if video is available
  const quoteCardStyle = options?.quoteCardStyle ?? "classic";
  let quoteImages: string[] = [];
  if (jobId > 0 && options?.videoPath && options?.videoDuration && quotes.length > 0) {
    try {
      quoteImages = await generateQuoteCards(
        jobId, quotes, quoteTimestamps,
        options.videoPath, quoteCardStyle,
        options?.brand ?? null, tmpDir, options.videoDuration,
      );
    } catch (e) {
      logger.warn({ jobId, e }, "Quote card generation failed — continuing without quote images");
    }
  }

  return {
    videoTitle,
    thumbnailUrl,
    youtubeUrl,
    blogPost: finalBlogPost,
    threadPosts: Array.isArray(a.threadPosts) ? (a.threadPosts as string[]) : [],
    socialArticle: (b.socialArticle as string) ?? "",
    newsletterEmail: {
      subject: (a.newsletterSubject as string) ?? "",
      body: newsletterHtml,
    },
    quotes,
    quoteTimestamps,
    quoteImages,
    quoteCardStyle,
    instagramCaptions: Array.isArray(a.instagramCaptions) ? (a.instagramCaptions as string[]).slice(0, 5) : [],
    carouselImages,
    carouselCaption: (a.carouselCaption as string) ?? "",
    podcastShowNotes: (b.podcastShowNotes as string) ?? "",
  };
}

export async function processJob(jobId: number): Promise<void> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `job_${jobId}_`));

  try {
    const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
    if (!job) throw new Error(`Job ${jobId} not found`);

    logger.info({ jobId }, "Starting video processing");

    // Load outro if set
    let outro: typeof outrosTable.$inferSelect | null = null;
    if (job.outroId) {
      const [found] = await db.select().from(outrosTable).where(eq(outrosTable.id, job.outroId));
      if (found && await objectExists(found.filePath)) {
        outro = found;
      } else {
        logger.warn({ jobId, outroId: job.outroId }, "Outro not found or file missing, skipping");
      }
    }

    // Load brand if set
    let brand: typeof brandsTable.$inferSelect | null = null;
    if (job.brandId) {
      const [foundBrand] = await db.select().from(brandsTable).where(eq(brandsTable.id, job.brandId));
      if (foundBrand) brand = foundBrand;
    }

    // Load brand outro rotation list (takes priority over single outro / brand shortFormOutroPath)
    let brandOutros: (typeof brandOutrosTable.$inferSelect)[] = [];
    if (job.brandOutroIds) {
      try {
        const ids: number[] = JSON.parse(job.brandOutroIds);
        if (ids.length > 0) {
          const found = await db.select().from(brandOutrosTable).where(inArray(brandOutrosTable.id, ids));
          // Keep the user-defined ordering and filter missing files
          const ordered = ids
            .map(id => found.find(o => o.id === id))
            .filter((o): o is typeof brandOutrosTable.$inferSelect => !!o);
          const existsFlags = await Promise.all(ordered.map(o => objectExists(o.filePath)));
          brandOutros = ordered.filter((_, i) => existsFlags[i]);
        }
      } catch (e) {
        logger.warn({ e, jobId }, "Failed to parse brandOutroIds — skipping rotation");
      }
    }

    // Load brand documents to enrich AI brand voice context
    let brandDocumentTexts: string[] = [];
    if (job.brandId) {
      try {
        const docs = await db.select().from(brandDocumentsTable)
          .where(eq(brandDocumentsTable.brandId, job.brandId));
        brandDocumentTexts = docs
          .filter(d => d.contentText && d.contentText.trim().length > 0)
          .map(d => d.contentText!.slice(0, 3000));
      } catch (e) {
        logger.warn({ e, jobId }, "Failed to load brand documents");
      }
    }

    // Load brand carousel template images to use as carousel slide backgrounds
    let brandCarouselTemplateKeys: string[] = [];
    if (job.brandId) {
      try {
        const templates = await db.select().from(brandCarouselTemplatesTable)
          .where(eq(brandCarouselTemplatesTable.brandId, job.brandId))
          .orderBy(brandCarouselTemplatesTable.sortOrder, brandCarouselTemplatesTable.createdAt);
        brandCarouselTemplateKeys = templates.map(t => t.filePath);
      } catch (e) {
        logger.warn({ e, jobId }, "Failed to load brand carousel templates");
      }
    }

    const clipDuration = job.clipDurationSeconds ?? 45;
    const wantPodcast = job.generatePodcast !== "false";

    // ── Transcript-only mode ─────────────────────────────────────────────────
    // When a manual transcript is pasted, skip download, audio extraction, and
    // all video rendering.  We convert the plain text to timed segments using
    // an estimated speaking pace and run content generation only.
    if (job.manualTranscript) {
      logger.info({ jobId }, "Manual transcript provided — skipping download and transcription");
      const title = job.videoTitle || "Pasted Transcript";
      const transcript = textToTranscriptSegments(job.manualTranscript);
      await db.update(jobsTable).set({ transcript: JSON.stringify(transcript) }).where(eq(jobsTable.id, jobId));
      await updateJobStatus(jobId, "analyzing");
      try {
        const content = await generateContent(job.youtubeUrl, title, transcript, {
          brandVoice: brand?.voiceStyle ?? null,
          contentCta: job.contentCta ?? null,
          brandName: brand?.name ?? null,
          brandWebsite: brand?.website ?? null,
          brandDocuments: brandDocumentTexts,
          jobId,
          brand,
          tempDir,
          carouselTemplates: brandCarouselTemplateKeys,
          thumbnailUrl: getUploadedThumbnailUrl(jobId, !!job.thumbnailPath),
        });
        await db.update(jobsTable).set({ generatedContent: JSON.stringify(content) }).where(eq(jobsTable.id, jobId));
        logger.info({ jobId }, "Content generation completed for transcript job");
      } catch (e) {
        logger.warn({ e, jobId }, "Content generation failed for transcript job — completing anyway");
      }
      await updateJobStatus(jobId, "completed");
      logger.info({ jobId }, "Transcript-only job completed");
      return;
    }

    // Step 1: Use the uploaded video (this app is upload-only — no
    // remote video fetching of any kind). Videos uploaded directly to object
    // storage (via presigned URL) need to be pulled down to local disk first;
    // videos uploaded through the legacy multipart route are already local.
    await updateJobStatus(jobId, "downloading");
    let localVideoPath = job.localFilePath;
    if (!localVideoPath || !fs.existsSync(localVideoPath)) {
      if (job.videoObjectPath) {
        logger.info({ jobId, videoObjectPath: job.videoObjectPath }, "Downloading uploaded video from object storage");
        const objectFile = await objectStorageService.getObjectEntityFile(job.videoObjectPath);
        const destPath = path.join(tempDir, `upload_${jobId}${path.extname(job.videoObjectPath) || ".mp4"}`);
        await objectFile.download({ destination: destPath });
        localVideoPath = destPath;
        await db.update(jobsTable).set({ localFilePath: destPath }).where(eq(jobsTable.id, jobId));
      } else {
        throw new Error("No uploaded video file found for this job.");
      }
    }
    const videoPath = localVideoPath;
    const rawName = job.youtubeUrl.startsWith("upload://")
      ? job.youtubeUrl.slice(9)
      : path.basename(videoPath);
    const derivedTitle = path.parse(rawName).name.replace(/[_\-]+/g, " ").trim() || "Uploaded Video";
    const title = job.userVideoTitle?.trim() || derivedTitle;
    await updateJobStatus(jobId, "downloading", { videoTitle: title });
    const videoDuration = await getVideoDuration(videoPath);

    // If the user didn't upload their own thumbnail, grab a still frame from
    // the video to use as the blog/email header image instead.
    let thumbnailPath = job.thumbnailPath;
    if (!thumbnailPath && job.thumbnailObjectPath) {
      try {
        logger.info({ jobId, thumbnailObjectPath: job.thumbnailObjectPath }, "Downloading uploaded thumbnail from object storage");
        const thumbFile = await objectStorageService.getObjectEntityFile(job.thumbnailObjectPath);
        const destThumbPath = path.join(tempDir, `thumb_${jobId}${path.extname(job.thumbnailObjectPath) || ".jpg"}`);
        await thumbFile.download({ destination: destThumbPath });
        thumbnailPath = destThumbPath;
        await db.update(jobsTable).set({ thumbnailPath: destThumbPath }).where(eq(jobsTable.id, jobId));
      } catch (e) {
        logger.warn({ e, jobId }, "Failed to download uploaded thumbnail from object storage");
      }
    }
    if (!thumbnailPath) {
      const autoThumbnailPath = await extractAutoThumbnail(videoPath, videoDuration, jobId);
      if (autoThumbnailPath) {
        thumbnailPath = autoThumbnailPath;
        await db.update(jobsTable).set({ thumbnailPath: autoThumbnailPath }).where(eq(jobsTable.id, jobId));
        logger.info({ jobId, autoThumbnailPath }, "Auto-extracted thumbnail frame from uploaded video");
      }
    }

    // Step 2: Extract audio and transcribe
    await updateJobStatus(jobId, "transcribing");
    const audioPath = await extractAudio(videoPath, tempDir);
    const transcript = await transcribeAudio(audioPath, videoDuration);
    await db.update(jobsTable).set({ transcript: JSON.stringify(transcript) }).where(eq(jobsTable.id, jobId));

    // Steps 3 & 4: AI clip selection + written content generation run in parallel
    // Both only need the transcript — no reason to wait for one before starting the other
    await updateJobStatus(jobId, "analyzing");

    let insertedClips: (typeof clipsTable.$inferSelect)[] = [];

    const clipMode = job.clipMode === "chapters" ? "chapters" : "ai";
    const clipSelectionPromise: Promise<ClipSegment[]> =
      clipMode === "chapters"
        ? selectClipsFromChapters(job.manualChapters, transcript, videoDuration, {
            brandVoice: brand?.voiceStyle ?? null,
            contentCta: job.contentCta ?? null,
          })
        : job.clipCount > 0
          ? selectBestClips(transcript, Math.min(6, Math.max(3, job.clipCount)), videoDuration, clipDuration)
          : Promise.resolve([] as ClipSegment[]);

    const [clipsResult, contentResult] = await Promise.allSettled([
      clipSelectionPromise,
      generateContent(job.youtubeUrl, title, transcript, {
        brandVoice: brand?.voiceStyle ?? null,
        contentCta: job.contentCta ?? null,
        brandName: brand?.name ?? null,
        brandWebsite: brand?.website ?? null,
        brandDocuments: brandDocumentTexts,
        jobId,
        brand,
        tempDir,
        carouselTemplates: brandCarouselTemplateKeys,
        thumbnailUrl: getUploadedThumbnailUrl(jobId, !!thumbnailPath),
        videoDescription: job.userVideoDescription ?? null,
        videoPath,
        videoDuration,
      }),
    ]);

    // Handle clip selection result
    if (clipsResult.status === "rejected") {
      throw clipsResult.reason as Error;
    }
    const clipSegments = clipsResult.value;
    if ((clipMode === "chapters" || job.clipCount > 0) && clipSegments.length === 0) {
      throw new Error("No clip segments were selected — the video may be too short or have no audio");
    }
    if (clipSegments.length > 0) {
      insertedClips = await db.insert(clipsTable).values(
        clipSegments.map((seg) => ({
          jobId,
          title: seg.title,
          startSeconds: seg.startSeconds.toString(),
          endSeconds: seg.endSeconds.toString(),
          durationSeconds: (seg.endSeconds - seg.startSeconds).toString(),
          status: "pending",
          instagramCaption: seg.instagramCaption || null,
        }))
      ).returning();
    }

    // Handle content generation result (non-fatal)
    if (contentResult.status === "fulfilled") {
      await db.update(jobsTable).set({ generatedContent: JSON.stringify(contentResult.value) }).where(eq(jobsTable.id, jobId));
      logger.info({ jobId }, "Content generation completed");
    } else {
      logger.warn({ jobId, err: contentResult.reason }, "Content generation failed — rendering will continue");
    }

    // Step 5: Render clips in small batches — batching 3 at a time gives a
    // meaningful speedup while avoiding CPU saturation on the production machine.
    const CLIP_BATCH_SIZE = 3;
    if (insertedClips.length > 0) {
      await updateJobStatus(jobId, "rendering", { errorMessage: `Preparing to render ${insertedClips.length} clip${insertedClips.length !== 1 ? "s" : ""}…` });

      // ── Prepare outro sources ──────────────────────────────────────────────
      //
      // Priority: brandOutros rotation > brand.shortFormOutroPath > global outro
      //
      // For rotation: pre-prepare each unique brand outro once, then assign
      // to clips by index (clip 0 → outro[0], clip 1 → outro[1], ..., wrapping).
      // For single sources the path is resolved before the loop.

      // Pre-prepare brand outro files (with CTA baked in)
      const preparedBrandOutros: Array<{ path: string; id: number }> = [];
      if (brandOutros.length > 0) {
        for (const bo of brandOutros) {
          const preparedPath = path.join(tempDir, `brand_outro_${bo.id}.mp4`);
          try {
            const localSource = path.join(tempDir, `brand_outro_src_${bo.id}.mp4`);
            await downloadToLocalFile(bo.filePath, localSource);
            if (bo.ctaText) {
              await prepareOutroWithCta(localSource, bo.ctaText, null, preparedPath);
            } else {
              fs.copyFileSync(localSource, preparedPath);
            }
            try { fs.unlinkSync(localSource); } catch (_) {}
            preparedBrandOutros.push({ path: preparedPath, id: bo.id });
          } catch (e) {
            logger.warn({ e, outroId: bo.id }, "Failed to prepare brand outro — skipping");
          }
        }
        logger.info({ jobId, count: preparedBrandOutros.length }, "Brand outros prepared for rotation");
      }

      // Prepare brand logo watermark (downloaded once, reused for every clip)
      const showWatermark = job.showWatermark !== "false";
      let watermarkLocalPath: string | null = null;
      if (showWatermark && brand?.logoPath && (await objectExists(brand.logoPath))) {
        try {
          watermarkLocalPath = path.join(tempDir, `watermark_logo${path.extname(brand.logoPath) || ".png"}`);
          await downloadToLocalFile(brand.logoPath, watermarkLocalPath);
        } catch (e) {
          logger.warn({ e, jobId }, "Failed to download brand logo watermark — skipping");
          watermarkLocalPath = null;
        }
      }
      const captionsEnabled = job.captionsEnabled !== "false";
      const captionStyle = job.captionStyle || "classic";
      const showTitle = job.showTitle !== "false";

      // Single-source fallback (brand shortFormOutroPath or global outro)
      let singleOutroPath: string | null = null;
      let singleOutroPosition = "end";
      if (preparedBrandOutros.length === 0) {
        if (brand?.shortFormOutroPath && await objectExists(brand.shortFormOutroPath)) {
          singleOutroPath = path.join(tempDir, `brand_short_form_outro${path.extname(brand.shortFormOutroPath) || ".mp4"}`);
          await downloadToLocalFile(brand.shortFormOutroPath, singleOutroPath);
          singleOutroPosition = "end";
          logger.info({ jobId }, "Using brand short-form outro video");
        } else if (outro) {
          const outroLocalSource = path.join(tempDir, "global_outro_src.mp4");
          await downloadToLocalFile(outro.filePath, outroLocalSource);
          singleOutroPath = path.join(tempDir, "outro_cta.mp4");
          singleOutroPosition = outro.position;
          await prepareOutroWithCta(
            outroLocalSource,
            outro.ctaText ?? null,
            outro.ctaStartSeconds ? parseFloat(outro.ctaStartSeconds) : null,
            singleOutroPath,
          );
          try { fs.unlinkSync(outroLocalSource); } catch (_) {}
        }
      }

      // Start Facebook square video + podcast audio immediately in the background —
      // both only need the source video and don't depend on clip output, so there's
      // no reason to wait for clips to finish before encoding them.
      const facebookBgPromise = (async () => {
        try {
          const facebookLocalPath = path.join(tempDir, `job_${jobId}_facebook.mp4`);
          await renderFullFacebookVideo(videoPath, jobId, transcript, facebookLocalPath);
          await uploadLocalFile(`clips/job_${jobId}_facebook.mp4`, facebookLocalPath, "video/mp4");
          try { fs.unlinkSync(facebookLocalPath); } catch (_) {}
          logger.info({ jobId }, "Full Facebook 1:1 video rendered");
        } catch (fbErr) {
          logger.warn({ jobId, err: fbErr }, "Full Facebook video render failed — skipping");
        }
      })();
      const podcastBgPromise = (async () => {
        if (!wantPodcast) { logger.info({ jobId }, "Podcast generation skipped (disabled)"); return; }
        try {
          await generatePodcastAudio(jobId, videoPath, brand);
        } catch (podErr) {
          logger.warn({ jobId, err: podErr }, "Podcast generation failed — skipping");
        }
      })();

      for (let batchStart = 0; batchStart < insertedClips.length; batchStart += CLIP_BATCH_SIZE) {
        const batch = insertedClips.slice(batchStart, batchStart + CLIP_BATCH_SIZE);
        const batchEnd = Math.min(batchStart + CLIP_BATCH_SIZE, insertedClips.length);
        await updateJobStatus(jobId, "rendering", {
          errorMessage: `Rendering clip${batch.length > 1 ? "s" : ""} ${batchStart + 1}${batch.length > 1 ? `–${batchEnd}` : ""} of ${insertedClips.length}…`,
        });

        await Promise.all(batch.map(async (clip, batchIdx) => {
          const clipIndex = batchStart + batchIdx;
          try {
            await db.update(clipsTable).set({ status: "rendering" }).where(eq(clipsTable.id, clip.id));

            const mainClipPath = path.join(tempDir, `main_clip_${clip.id}.mp4`);
            await renderMainClip(
              videoPath,
              clip.id,
              clip.title,
              parseFloat(clip.startSeconds),
              parseFloat(clip.endSeconds),
              transcript,
              mainClipPath,
              {
                captionsEnabled,
                captionStyle,
                showTitle,
                showWatermark,
                watermarkLocalPath,
                brand,
              },
            );

            // Name the final file using the clip's AI-generated title for easy identification
            const safeTitle = sanitizeFilename(clip.title);
            const finalPath = path.join(tempDir, `${safeTitle}_${clip.id}.mp4`);

            // Pick outro for this specific clip (rotation or single source)
            const clipOutroPath = preparedBrandOutros.length > 0
              ? preparedBrandOutros[clipIndex % preparedBrandOutros.length].path
              : singleOutroPath;
            const clipOutroPosition = preparedBrandOutros.length > 0 ? "end" : singleOutroPosition;

            if (clipOutroPath) {
              await concatenateClipWithOutro(
                mainClipPath,
                clipOutroPath,
                clipOutroPosition,
                finalPath,
                tempDir,
                clip.id,
              );
            } else {
              fs.copyFileSync(mainClipPath, finalPath);
            }

            const clipKey = `clips/${safeTitle}_${clip.id}.mp4`;
            await uploadLocalFile(clipKey, finalPath, "video/mp4");
            try { fs.unlinkSync(finalPath); } catch (_) {}

            await db.update(clipsTable).set({
              status: "completed",
              filePath: clipKey,
            }).where(eq(clipsTable.id, clip.id));

            logger.info({ clipId: clip.id, title: clip.title }, "Clip rendered successfully");
          } catch (clipErr) {
            logger.error({ clipId: clip.id, err: clipErr }, "Failed to render clip");
            await db.update(clipsTable).set({ status: "failed" }).where(eq(clipsTable.id, clip.id));
          }
        }));
      }

      // Wait for background renders to finish (they've been running alongside clips)
      await Promise.allSettled([facebookBgPromise, podcastBgPromise]);
    } else {
      // No clips — still generate podcast audio if enabled
      if (wantPodcast) {
        try {
          await updateJobStatus(jobId, "rendering", { errorMessage: "Generating podcast audio…" });
          await generatePodcastAudio(jobId, videoPath, brand);
        } catch (podErr) {
          logger.warn({ jobId, err: podErr }, "Podcast generation failed — skipping");
        }
      }
    }

    await updateJobStatus(jobId, "completed");
    logger.info({ jobId }, "Job completed successfully");
  } catch (err) {
    logger.error({ jobId, err }, "Job processing failed");
    await updateJobStatus(jobId, "failed", {
      errorMessage: err instanceof Error ? err.message : String(err),
    });
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (e) {
      logger.warn({ e }, "Failed to clean up temp dir");
    }
  }
}

// Re-generates quote card images in a new visual style without re-running the
// full AI pipeline.  Reads existing quotes + timestamps from stored content.
export async function regenerateQuoteCards(
  jobId: number,
  style: string,
  userId: string,
): Promise<GeneratedContent> {
  const [job] = await db.select().from(jobsTable)
    .where(and(eq(jobsTable.id, jobId), eq(jobsTable.userId, userId)));
  if (!job) throw new Error(`Job ${jobId} not found`);
  if (!job.generatedContent) throw new Error("No generated content found for this job");

  const content: GeneratedContent = JSON.parse(job.generatedContent);
  const quotes = content.quotes ?? [];
  const quoteTimestamps = content.quoteTimestamps ?? [];

  if (quotes.length === 0) throw new Error("No quotes available for this job");

  // Resolve the video path (prefer already-downloaded local path)
  let videoPath = job.localFilePath;
  if (!videoPath || !fs.existsSync(videoPath)) {
    if (!job.videoObjectPath) throw new Error("No video available for quote card generation");
    const destPath = path.join(os.tmpdir(), `qc_regen_${jobId}${path.extname(job.videoObjectPath) || ".mp4"}`);
    if (!fs.existsSync(destPath)) {
      const objectFile = await objectStorageService.getObjectEntityFile(job.videoObjectPath);
      await objectFile.download({ destination: destPath });
    }
    videoPath = destPath;
  }

  let brand: typeof brandsTable.$inferSelect | null = null;
  if (job.brandId) {
    const [foundBrand] = await db.select().from(brandsTable).where(eq(brandsTable.id, job.brandId));
    if (foundBrand) brand = foundBrand;
  }

  const videoDuration = await getVideoDuration(videoPath);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `qc_${jobId}_`));

  try {
    const newImages = await generateQuoteCards(
      jobId, quotes, quoteTimestamps, videoPath, style, brand, tempDir, videoDuration,
    );
    const updated: GeneratedContent = { ...content, quoteImages: newImages, quoteCardStyle: style };
    await db.update(jobsTable)
      .set({ generatedContent: JSON.stringify(updated) })
      .where(eq(jobsTable.id, jobId));
    return updated;
  } finally {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
  }
}
