import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";
import os from "os";
import { db, jobsTable, clipsTable, outrosTable, brandsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { openai } from "@workspace/integrations-openai-ai-server";
import { logger } from "./logger";

const execFileAsync = promisify(execFile);

const YTDLP = fs.existsSync("/home/runner/workspace/bin/yt-dlp")
  ? "/home/runner/workspace/bin/yt-dlp"
  : "yt-dlp";

const CLIPS_DIR = path.join(process.cwd(), "clips");
fs.mkdirSync(CLIPS_DIR, { recursive: true });

const FONTS_CACHE_DIR = path.join(process.cwd(), "fonts");
fs.mkdirSync(FONTS_CACHE_DIR, { recursive: true });

const LOGO_PATH = path.join(process.cwd(), "src", "assets", "taw-logo.png");
const POPPINS_BOLD_PATH = path.join(process.cwd(), "src", "assets", "fonts", "Poppins-Bold.ttf");
const DEJAVU_BOLD_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";

function hexToFfmpeg(hex: string): string {
  return "0x" + hex.replace(/^#/, "");
}

async function getFontPath(fontFamily: string | null): Promise<string> {
  const defaultFont = fs.existsSync(POPPINS_BOLD_PATH) ? POPPINS_BOLD_PATH : DEJAVU_BOLD_PATH;
  if (!fontFamily || fontFamily.toLowerCase() === "poppins") return defaultFont;

  const safe = fontFamily.replace(/[^a-zA-Z0-9 ]/g, "").trim();
  if (!safe) return defaultFont;

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

interface ClipSegment {
  title: string;
  startSeconds: number;
  endSeconds: number;
  reasoning: string;
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
  quoteImages: string[];
  instagramCaptions: string[];
  carouselImages: string[];
  carouselCaption: string;
}

async function updateJobStatus(jobId: number, status: string, extra?: { videoTitle?: string; errorMessage?: string }): Promise<void> {
  await db.update(jobsTable).set({
    status,
    ...(extra?.videoTitle ? { videoTitle: extra.videoTitle } : {}),
    ...(extra?.errorMessage ? { errorMessage: extra.errorMessage } : {}),
  }).where(eq(jobsTable.id, jobId));
}

async function downloadVideo(youtubeUrl: string, outputDir: string): Promise<{ videoPath: string; title: string }> {
  const infoArgs = ["--print", "%(title)s", "--no-playlist", youtubeUrl];
  let title = "Untitled Video";
  try {
    const { stdout } = await execFileAsync(YTDLP, infoArgs, { timeout: 30000 });
    title = stdout.trim().split("\n")[0] || title;
  } catch (e) {
    logger.warn({ e }, "Could not fetch video title");
  }

  const videoPath = path.join(outputDir, "video.mp4");
  const dlArgs = [
    "--no-playlist",
    "--extractor-args", "youtube:player_client=android_vr",
    "-f", "bestvideo[ext=mp4][height<=720]+bestaudio[ext=m4a]/bestvideo[height<=720]+bestaudio/best[height<=720]/best",
    "--merge-output-format", "mp4",
    "-o", videoPath,
    youtubeUrl,
  ];
  await execFileAsync(YTDLP, dlArgs, { timeout: 300000 });

  if (!fs.existsSync(videoPath)) {
    throw new Error("Video download failed — output file not found");
  }
  return { videoPath, title };
}

async function extractAudio(videoPath: string, outputDir: string): Promise<string> {
  const audioPath = path.join(outputDir, "audio.mp3");
  await execFileAsync("ffmpeg", [
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
    "reasoning": "Why this segment works well"
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

async function getVideoDuration(videoPath: string): Promise<number> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "quiet", "-print_format", "json", "-show_format", videoPath,
  ], { timeout: 30000 });
  const info = JSON.parse(stdout);
  return parseFloat(info.format?.duration || "0");
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

async function generateCarouselSlides(
  jobId: number,
  slides: CarouselSlide[],
  brand: typeof brandsTable.$inferSelect | null,
  tempDir: string,
): Promise<string[]> {
  const fontFile = await getFontPath(brand?.fontFamily ?? null);
  const primary = brand?.primaryColor ?? "#f21178";
  const secondary = brand?.secondaryColor ?? "#7c3aed";
  const primaryFf = hexToFfmpeg(primary);
  const secondaryFf = hexToFfmpeg(secondary);
  const brandLabel = brand?.name ?? "Content Rocket";
  const filenames: string[] = [];

  for (let i = 0; i < slides.length; i++) {
    try {
      const slide = slides[i];
      const filename = `carousel_${jobId}_${i + 1}.png`;
      const outputPath = path.join(CLIPS_DIR, filename);

      // Try to generate an AI background image for this slide
      const bgPath = await generateSlideBackground(slide.title, slide.bullets, primary, tempDir);

      // Wrap title at 20 chars per line
      const titleLines = wrapText(slide.title.toUpperCase(), 20);
      const bullets = slide.bullets.slice(0, 4).map(b => wrapText(b, 26)[0] || b);

      // Base filters differ based on whether we have an AI background
      const filters: string[] = bgPath
        ? [
            `scale=1080:1080:force_original_aspect_ratio=fill`,
            `crop=1080:1080`,
            `drawbox=x=0:y=0:w=1080:h=1080:color=black@0.55:t=fill`,
          ]
        : [
            `drawbox=x=0:y=0:w=1080:h=1080:color=0x0a0618@1:t=fill`,
            `drawbox=x=0:y=0:w=1080:h=400:color=0x140a28@0.5:t=fill`,
          ];

      // Brand accent bar (left edge) using primary color
      filters.push(`drawbox=x=0:y=0:w=10:h=1080:color=${primaryFf}@1:t=fill`);
      // Bottom brand bar
      filters.push(`drawbox=x=0:y=940:w=1080:h=140:color=black@0.75:t=fill`);
      // Slide counter top-right
      filters.push(`drawtext=fontfile=${fontFile}:text='${i + 1} / ${slides.length}':fontsize=34:fontcolor=${primaryFf}:x=980:y=50:shadowx=2:shadowy=2:shadowcolor=black@0.8`);

      // Title lines
      titleLines.slice(0, 3).forEach((line, j) => {
        filters.push(
          `drawtext=fontfile=${fontFile}:text='${escapeFfmpegText(line)}':fontsize=68:fontcolor=white:x=50:y=${130 + j * 85}:shadowx=3:shadowy=3:shadowcolor=black@0.9`
        );
      });

      // Horizontal divider in secondary color
      const dividerY = 130 + Math.min(titleLines.length, 3) * 85 + 15;
      filters.push(`drawbox=x=50:y=${dividerY}:w=200:h=4:color=${secondaryFf}@1:t=fill`);

      // Bullet points
      bullets.forEach((bullet, j) => {
        const bulletY = dividerY + 45 + j * 72;
        if (bulletY < 910) {
          filters.push(
            `drawtext=fontfile=${fontFile}:text='${escapeFfmpegText("  " + bullet)}':fontsize=40:fontcolor=white:x=50:y=${bulletY}:shadowx=2:shadowy=2:shadowcolor=black@0.7`
          );
        }
      });

      // Brand label in bottom bar using primary color
      filters.push(
        `drawtext=fontfile=${fontFile}:text='${escapeFfmpegText(brandLabel)}':fontsize=30:fontcolor=${primaryFf}:x=(w-text_w)/2:y=970:shadowx=1:shadowy=1:shadowcolor=black@0.8`
      );

      const ffmpegArgs = bgPath
        ? ["-i", bgPath, "-vf", filters.join(","), "-frames:v", "1", "-y", outputPath]
        : ["-f", "lavfi", "-i", "color=c=black:s=1080x1080:d=1", "-vf", filters.join(","), "-frames:v", "1", "-y", outputPath];

      await execFileAsync("ffmpeg", ffmpegArgs, { timeout: 30000 });

      if (bgPath) {
        try { fs.unlinkSync(bgPath); } catch (_) {}
      }

      filenames.push(filename);
      logger.info({ jobId, slideIndex: i + 1, hasBg: !!bgPath }, "Carousel slide rendered");
    } catch (err) {
      logger.warn({ jobId, slideIndex: i + 1, err }, "Failed to render carousel slide — skipping");
    }
  }

  return filenames;
}

export async function generatePodcastAudio(
  jobId: number,
  videoPath: string,
  brand: typeof brandsTable.$inferSelect | null,
): Promise<string | null> {
  const podcastPath = path.join(CLIPS_DIR, `job_${jobId}_podcast.mp3`);

  try {
    const introPath = brand?.introAudioPath && fs.existsSync(brand.introAudioPath)
      ? brand.introAudioPath
      : null;
    const outroPath = brand?.outroAudioPath && fs.existsSync(brand.outroAudioPath)
      ? brand.outroAudioPath
      : null;

    if (!introPath && !outroPath) {
      // Simple extraction — no mixing needed
      await execFileAsync("ffmpeg", [
        "-i", videoPath,
        "-vn",
        "-acodec", "libmp3lame",
        "-b:a", "192k",
        "-ar", "44100",
        "-ac", "2",
        podcastPath, "-y",
      ], { timeout: 600000 });
    } else {
      // Extract main audio first
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `podcast_${jobId}_`));
      const mainAudioPath = path.join(tempDir, "main.mp3");

      await execFileAsync("ffmpeg", [
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

      await execFileAsync("ffmpeg", [
        "-f", "concat",
        "-safe", "0",
        "-i", concatListPath,
        "-acodec", "libmp3lame",
        "-b:a", "192k",
        "-ar", "44100",
        "-ac", "2",
        podcastPath, "-y",
      ], { timeout: 600000 });

      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
    }

    logger.info({ jobId }, "Podcast audio generated");
    return podcastPath;
  } catch (err) {
    logger.warn({ jobId, err }, "Podcast generation failed");
    return null;
  }
}

async function renderMainClip(
  videoPath: string,
  clipId: number,
  title: string,
  startSeconds: number,
  endSeconds: number,
  _transcript: TranscriptSegment[],
  outputPath: string,
): Promise<void> {
  const portraitCrop = "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920";
  const logoExists = fs.existsSync(LOGO_PATH);

  if (logoExists) {
    const filterComplex = [
      `[0:v]${portraitCrop}[bg]`,
      `[1:v]scale=280:-1[logo]`,
      `[bg][logo]overlay=x=(W-w)/2:y=30[v]`,
    ].join(";");

    await execFileAsync("ffmpeg", [
      "-ss", startSeconds.toString(),
      "-i", videoPath,
      "-loop", "1", "-i", LOGO_PATH,
      "-t", (endSeconds - startSeconds).toString(),
      "-filter_complex", filterComplex,
      "-map", "[v]",
      "-map", "0:a",
      "-c:v", "libx264", "-preset", "fast", "-crf", "23",
      "-c:a", "aac", "-b:a", "128k",
      "-metadata", `title=${title}`,
      "-movflags", "+faststart",
      outputPath, "-y",
    ], { timeout: 300000 });
  } else {
    await execFileAsync("ffmpeg", [
      "-ss", startSeconds.toString(),
      "-i", videoPath,
      "-t", (endSeconds - startSeconds).toString(),
      "-vf", portraitCrop,
      "-c:v", "libx264", "-preset", "fast", "-crf", "23",
      "-c:a", "aac", "-b:a", "128k",
      "-metadata", `title=${title}`,
      "-movflags", "+faststart",
      outputPath, "-y",
    ], { timeout: 300000 });
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
  jobId: number,
  transcript: TranscriptSegment[],
  outputPath: string,
): Promise<void> {
  const squareCrop = "scale=1080:1080:force_original_aspect_ratio=increase,crop=1080:1080";
  const captionFont = fs.existsSync(POPPINS_BOLD_PATH) ? POPPINS_BOLD_PATH : DEJAVU_BOLD_PATH;
  const fontDir = path.dirname(captionFont);

  const srtPath = path.join(CLIPS_DIR, `job_${jobId}_facebook.srt`);
  fs.writeFileSync(srtPath, transcriptToSrt(transcript), "utf8");

  const forceStyle = "FontName=Poppins Bold,Fontsize=22,PrimaryColour=&H00FFFFFF,Bold=1,Outline=3,OutlineColour=&H00000000,BackColour=&H40000000,Alignment=2,MarginV=60";

  const vf = [
    squareCrop,
    `subtitles=${srtPath}:fontsdir=${fontDir}:force_style='${forceStyle}'`,
  ].join(",");

  try {
    await execFileAsync("ffmpeg", [
      "-i", videoPath,
      "-vf", vf,
      "-c:v", "libx264", "-preset", "fast", "-crf", "23",
      "-c:a", "aac", "-b:a", "128k",
      "-movflags", "+faststart",
      outputPath, "-y",
    ], { timeout: 3600000 });
  } finally {
    try { fs.unlinkSync(srtPath); } catch (_) {}
  }
}

async function prepareOutroWithCta(
  outroFilePath: string,
  ctaText: string | null,
  ctaStartSeconds: number | null,
  outputPath: string,
): Promise<void> {
  if (!ctaText || ctaText.trim() === "") {
    await execFileAsync("ffmpeg", [
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
  const ctaFilter = `drawtext=text='${outroText}':fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:fontsize=30:fontcolor=white:x=(w-text_w)/2:y=h-th-60:enable='gte(t,${startSec.toFixed(2)})':borderw=3:bordercolor=black@0.8`;

  await execFileAsync("ffmpeg", [
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
): Promise<void> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "quiet", "-print_format", "json", "-show_streams",
    "-select_streams", "v:0", mainClipPath,
  ], { timeout: 30000 });

  const info = JSON.parse(stdout);
  const stream = info.streams?.[0];
  const width = stream?.width || 1280;
  const height = stream?.height || 720;

  const scaledOutroPath = path.join(tempDir, "outro_scaled.mp4");
  await execFileAsync("ffmpeg", [
    "-i", outroPath,
    "-vf", `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black`,
    "-c:v", "libx264", "-preset", "fast", "-crf", "23",
    "-c:a", "aac", "-b:a", "128k",
    "-movflags", "+faststart",
    scaledOutroPath, "-y",
  ], { timeout: 120000 });

  const concatListPath = path.join(tempDir, "concat_list.txt");
  const concatContent = position === "beginning"
    ? `file '${scaledOutroPath}'\nfile '${mainClipPath}'\n`
    : `file '${mainClipPath}'\nfile '${scaledOutroPath}'\n`;
  fs.writeFileSync(concatListPath, concatContent);

  await execFileAsync("ffmpeg", [
    "-f", "concat",
    "-safe", "0",
    "-i", concatListPath,
    "-c:v", "libx264", "-preset", "fast", "-crf", "23",
    "-c:a", "aac", "-b:a", "128k",
    "-movflags", "+faststart",
    finalOutputPath, "-y",
  ], { timeout: 300000 });
}

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

export async function generateContent(
  youtubeUrl: string,
  videoTitle: string,
  transcript: TranscriptSegment[],
  options?: {
    brandVoice?: string | null;
    contentCta?: string | null;
    brandName?: string | null;
    brandWebsite?: string | null;
    jobId?: number;
    brand?: typeof brandsTable.$inferSelect | null;
    tempDir?: string;
  },
): Promise<GeneratedContent> {
  const thumbnailUrl = getThumbnailUrl(youtubeUrl);
  const transcriptText = transcript.map((s) => s.text).join(" ").slice(0, 10000);
  const jobId = options?.jobId ?? 0;

  const brandVoiceNote = options?.brandVoice
    ? `\n\nBRAND VOICE STYLE: ${options.brandVoice}\nApply this voice consistently across all content.`
    : "";

  const ctaNote = options?.contentCta
    ? `\n\nCTA TO APPEND: "${options.contentCta}" — include this as the final call-to-action in all text content pieces.`
    : "";

  // ── Call A: short-form content ──────────────────────────────────────────
  const promptA = `You are a professional content creator. Based on this YouTube video transcript, generate short-form social content.${brandVoiceNote}${ctaNote}

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
  "instagramCaptions": [
    "Instagram/TikTok caption for Quote 1. Hook line. 3-4 first-person story paragraphs elaborating on the quote using real insights. Open question. 8-10 hashtags on their own line. CTA line. 250-350 words total.",
    "Caption for Quote 2. Same structure. Different angle.",
    "Caption for Quote 3. Same structure. Different angle.",
    "Caption for Quote 4. Same structure. Different angle.",
    "Caption for Quote 5. Same structure. Different angle."
  ],
  "threadPosts": [
    "Hook — the single most compelling insight. Start with the insight, no preamble. Max 280 chars.",
    "Key insight from the video. Start directly with the content. Max 280 chars.",
    "Another insight or tactical tip. Max 280 chars.",
    "Practical action step the viewer can use immediately. Max 280 chars.",
    "Wrap-up inviting people to watch the full video — include the URL: ${youtubeUrl}. Max 280 chars."
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

  const promptB = `You are a professional content creator. Based on this YouTube video transcript, generate long-form written content.${brandVoiceNote}

VIDEO TITLE: ${videoTitle}
VIDEO URL: ${youtubeUrl}

TRANSCRIPT:
${transcriptText}

Return ONLY a valid JSON object with these exact keys — no markdown fences, no explanation:

{
  "blogPost": "SEO-OPTIMISED HTML BLOG POST. ALLOWED TAGS: <h1> <h2> <h3> <p> <strong> <em> <ul> <li> only. STRUCTURE: (1) <h1> SEO title. (2) 2-3 <p> hook paragraphs. (3) 6-8 <h2> sections each with 2-3 <p> paragraphs; use <h3> for sub-steps followed by <ul><li>. (4) LAST: <p><strong>TL;DR:</strong> 3-4 sentence summary</p>.${ctaSuffix} TARGET: minimum 1500 words.",
  "socialArticle": "HTML article for Facebook, Quora, LinkedIn. ALLOWED TAGS: <h2> <p> <strong> <em> <ul> <li> only. TARGET: 500 words. STRUCTURE: <p> hook. 2-3 <h2> sections. One <ul><li> list. Final <p> ending with: 'FREE autism life hacks book — link in comments.'",
  "faqItems": [{"question": "FREQUENTLY ASKED QUESTION about the topic", "answer": "CLEAR, HELPFUL ANSWER (2-3 sentences)"}]
}`;

  const [responseA, responseB] = await Promise.all([
    openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: promptA }],
      max_completion_tokens: 8000,
    }),
    openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: promptB }],
      max_completion_tokens: 8000,
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

  // Generate carousel images if slides were returned
  let carouselImages: string[] = [];
  const rawSlides = a.carouselSlides;
  if (Array.isArray(rawSlides) && rawSlides.length > 0 && jobId > 0) {
    const slides = (rawSlides as Array<{ title?: string; bullets?: string[] }>).map(s => ({
      title: s.title ?? "Key Insight",
      bullets: Array.isArray(s.bullets) ? s.bullets : [],
    }));
    carouselImages = await generateCarouselSlides(jobId, slides, options?.brand ?? null, options?.tempDir ?? os.tmpdir());
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
    quotes: Array.isArray(a.quotes) ? (a.quotes as string[]).slice(0, 5) : [],
    quoteImages: [],
    instagramCaptions: Array.isArray(a.instagramCaptions) ? (a.instagramCaptions as string[]).slice(0, 5) : [],
    carouselImages,
    carouselCaption: (a.carouselCaption as string) ?? "",
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
      if (found && fs.existsSync(found.filePath)) {
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

    const clipDuration = job.clipDurationSeconds ?? 45;

    // Step 1: Download
    await updateJobStatus(jobId, "downloading");
    const { videoPath, title } = await downloadVideo(job.youtubeUrl, tempDir);
    await updateJobStatus(jobId, "downloading", { videoTitle: title });
    const videoDuration = await getVideoDuration(videoPath);

    // Step 2: Extract audio and transcribe
    await updateJobStatus(jobId, "transcribing");
    const audioPath = await extractAudio(videoPath, tempDir);
    const transcript = await transcribeAudio(audioPath, videoDuration);
    await db.update(jobsTable).set({ transcript: JSON.stringify(transcript) }).where(eq(jobsTable.id, jobId));

    // Step 3: AI clip selection (skip if clipCount === 0)
    let clipSegments: ClipSegment[] = [];
    let insertedClips: (typeof clipsTable.$inferSelect)[] = [];

    if (job.clipCount > 0) {
      await updateJobStatus(jobId, "analyzing");
      clipSegments = await selectBestClips(transcript, job.clipCount, videoDuration, clipDuration);

      if (clipSegments.length === 0) {
        throw new Error("No clip segments were selected — the video may be too short or have no audio");
      }

      insertedClips = await db.insert(clipsTable).values(
        clipSegments.map((seg) => ({
          jobId,
          title: seg.title,
          startSeconds: seg.startSeconds.toString(),
          endSeconds: seg.endSeconds.toString(),
          durationSeconds: (seg.endSeconds - seg.startSeconds).toString(),
          status: "pending",
        }))
      ).returning();
    } else {
      await updateJobStatus(jobId, "analyzing");
    }

    // Step 4: Generate written content (non-fatal)
    try {
      const content = await generateContent(job.youtubeUrl, title, transcript, {
        brandVoice: brand?.voiceStyle ?? null,
        contentCta: job.contentCta ?? null,
        brandName: brand?.name ?? null,
        brandWebsite: brand?.website ?? null,
        jobId,
        brand,
        tempDir,
      });
      await db.update(jobsTable).set({ generatedContent: JSON.stringify(content) }).where(eq(jobsTable.id, jobId));
      logger.info({ jobId }, "Content generation completed");
    } catch (contentErr) {
      logger.warn({ jobId, err: contentErr }, "Content generation failed — rendering will continue");
    }

    // Step 5: Render clips (skip if none)
    if (insertedClips.length > 0) {
      await updateJobStatus(jobId, "rendering");

      let processedOutroPath: string | null = null;
      if (outro) {
        processedOutroPath = path.join(tempDir, "outro_cta.mp4");
        await prepareOutroWithCta(
          outro.filePath,
          outro.ctaText ?? null,
          outro.ctaStartSeconds ? parseFloat(outro.ctaStartSeconds) : null,
          processedOutroPath,
        );
      }

      for (const clip of insertedClips) {
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
          );

          const finalPath = path.join(CLIPS_DIR, `clip_${clip.id}.mp4`);

          if (processedOutroPath && outro) {
            await concatenateClipWithOutro(
              mainClipPath,
              processedOutroPath,
              outro.position,
              finalPath,
              tempDir,
            );
          } else {
            fs.copyFileSync(mainClipPath, finalPath);
          }

          await db.update(clipsTable).set({
            status: "completed",
            filePath: finalPath,
          }).where(eq(clipsTable.id, clip.id));

          logger.info({ clipId: clip.id }, "Clip rendered successfully");
        } catch (clipErr) {
          logger.error({ clipId: clip.id, err: clipErr }, "Failed to render clip");
          await db.update(clipsTable).set({ status: "failed" }).where(eq(clipsTable.id, clip.id));
        }
      }

      // Step 6: Render full Facebook 1:1 video (non-fatal)
      try {
        const facebookPath = path.join(CLIPS_DIR, `job_${jobId}_facebook.mp4`);
        await renderFullFacebookVideo(videoPath, jobId, transcript, facebookPath);
        logger.info({ jobId }, "Full Facebook 1:1 video rendered");
      } catch (fbErr) {
        logger.warn({ jobId, err: fbErr }, "Full Facebook video render failed — skipping");
      }
    }

    // Step 7: Generate podcast audio (non-fatal)
    try {
      await generatePodcastAudio(jobId, videoPath, brand);
    } catch (podErr) {
      logger.warn({ jobId, err: podErr }, "Podcast generation failed — skipping");
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
