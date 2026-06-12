import { execFile, execFileSync } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";
import os from "os";
import { db, jobsTable, clipsTable, outrosTable, brandsTable, brandOutrosTable, brandDocumentsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { openai } from "@workspace/integrations-openai-ai-server";
import { logger } from "./logger";

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

const YTDLP = fs.existsSync("/home/runner/workspace/bin/yt-dlp")
  ? "/home/runner/workspace/bin/yt-dlp"
  : "yt-dlp";


// Write YOUTUBE_COOKIES to a temp file and return its path, or null if unset.
// Accepts:
//   1. Raw Netscape cookies.txt content (actual newlines + tabs)
//   2. Escaped version where \n/\t are literal two-character sequences
//      (Replit secrets UI sometimes stores multiline values this way)
//   3. Base64-encoded Netscape cookies.txt
function writeCookiesFile(): string | null {
  const raw = process.env.YOUTUBE_COOKIES;
  if (!raw || !raw.trim()) {
    logger.info("YOUTUBE_COOKIES not set — downloading without cookies");
    return null;
  }
  try {
    logger.info(
      { len: raw.length, hasActualNewline: raw.includes("\n"), hasEscapedNewline: raw.includes("\\n"), hasTab: /\t/.test(raw), hasEscapedTab: raw.includes("\\t"), preview: raw.slice(0, 60).replace(/\n/g, "↵") },
      "YOUTUBE_COOKIES detected — processing",
    );

    let content = raw;

    // If the secret was stored with escaped sequences (no actual newlines but
    // has literal \n), unescape it first so the rest of the logic works.
    if (!raw.includes("\n") && raw.includes("\\n")) {
      content = raw.replace(/\\n/g, "\n").replace(/\\t/g, "\t");
      logger.info("YOUTUBE_COOKIES: unescaped \\n/\\t sequences");
    }

    // Detect raw Netscape format: has header comment or tab-separated cookie rows.
    // If it doesn't look like Netscape, assume it's base64-encoded.
    const looksLikeNetscape =
      content.includes("# Netscape HTTP Cookie File") ||
      content.includes("# HTTP Cookie File") ||
      content.includes("youtube.com") ||
      /\t/.test(content);

    if (!looksLikeNetscape) {
      logger.info("YOUTUBE_COOKIES: attempting base64 decode");
      content = Buffer.from(content.trim(), "base64").toString("utf8");
    }

    if (!content.includes("\n")) {
      logger.warn({ len: content.length }, "YOUTUBE_COOKIES has no newlines after processing — invalid format, proceeding without cookies");
      return null;
    }

    const cookiePath = path.join(os.tmpdir(), `yt_cookies_${process.pid}.txt`);
    fs.writeFileSync(cookiePath, content, { mode: 0o600 });
    logger.info({ cookiePath, lines: content.split("\n").length }, "YOUTUBE_COOKIES written to temp file");
    return cookiePath;
  } catch (e) {
    logger.warn({ e }, "Failed to write YouTube cookies file — proceeding without cookies");
    return null;
  }
}

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
  quoteImages: string[];
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

async function downloadVideo(youtubeUrl: string, outputDir: string): Promise<{ videoPath: string; title: string }> {
  const cookiesFile = writeCookiesFile();
  const cookiesArgs = cookiesFile ? ["--cookies", cookiesFile] : [];

  // Proxy: if YTDLP_PROXY is set (e.g. http://user:pass@host:port), route all
  // yt-dlp traffic through it.  A residential proxy is the most reliable
  // cookieless fix for YouTube bot-detection on datacenter IPs — YouTube sees
  // a home IP instead of a cloud server and doesn't challenge it.
  const proxy = process.env.YTDLP_PROXY?.trim();
  const proxyArgs = proxy ? ["--proxy", proxy] : [];

  // Use the Android player client first: YouTube's Android API has lighter
  // bot-detection than the browser client and often works from server IPs.
  // Falls back to web client automatically if Android fails.
  const clientArgs = ["--extractor-args", "youtube:player_client=android,web"];

  const resilienceArgs = [
    "--retries", "5",
    "--extractor-retries", "5",
    "--retry-sleep", "exp=1:30",
    "--sleep-requests", "1",
    "--socket-timeout", "30",
    "--force-ipv4",
  ];
  const baseArgs = [
    "--no-playlist",
    ...proxyArgs,
    ...clientArgs,
    ...cookiesArgs,
    ...resilienceArgs,
  ];

  logger.info({ hasCookies: !!cookiesFile, hasProxy: !!proxy }, "yt-dlp download starting");

  const infoArgs = [...baseArgs, "--print", "%(title)s", youtubeUrl];
  let title = "Untitled Video";
  try {
    const { stdout } = await execFileAsync(YTDLP, infoArgs, { timeout: 60000, env: process.env });
    title = stdout.trim().split("\n")[0] || title;
  } catch (e) {
    logger.warn({ e }, "Could not fetch video title");
  }

  const videoPath = path.join(outputDir, "video.mp4");
  const dlArgs = [
    ...baseArgs,
    "-f", "bestvideo[ext=mp4][height<=1080]+bestaudio[ext=m4a]/bestvideo[height<=1080]+bestaudio/best[height<=1080]/best",
    "--merge-output-format", "mp4",
    "-o", videoPath,
    youtubeUrl,
  ];

  try {
    await execFileAsync(YTDLP, dlArgs, { timeout: 300000, env: process.env });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/Sign in to confirm|not a bot|HTTP Error 429|Too Many Requests/i.test(msg)) {
      const fixes: string[] = [];
      if (!proxy) fixes.push("set YTDLP_PROXY to a residential proxy URL (e.g. http://user:pass@host:port) — most reliable fix");
      if (!cookiesFile) fixes.push("set YOUTUBE_COOKIES to a freshly exported Netscape cookies.txt from a logged-in browser");
      throw new Error(
        `YouTube is blocking downloads from this server's IP (bot detection).${fixes.length ? " To fix: " + fixes.join("; or ") + "." : " Both YTDLP_PROXY and YOUTUBE_COOKIES are set — the cookies may have expired."}`,
      );
    }
    throw e;
  } finally {
    // Clean up temp cookies file
    if (cookiesFile) {
      try { fs.unlinkSync(cookiesFile); } catch { /* ignore */ }
    }
  }

  if (!fs.existsSync(videoPath)) {
    throw new Error("Video download failed — output file not found");
  }
  return { videoPath, title };
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

async function getVideoDuration(videoPath: string): Promise<number> {
  const { stdout } = await execFileAsync(FFPROBE, [
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

  // Step A: generate all AI backgrounds in parallel — independent API calls
  const bgPaths = await Promise.all(
    slides.map(slide => generateSlideBackground(slide.title, slide.bullets, primary, tempDir))
  );

  // Step B: render all slides in parallel — each ffmpeg call is fully independent
  const results = await Promise.allSettled(
    slides.map(async (slide, i) => {
      const bgPath = bgPaths[i];
      const filename = `carousel_${jobId}_${i + 1}.png`;
      const outputPath = path.join(CLIPS_DIR, filename);

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

      if (bgPath) {
        try { fs.unlinkSync(bgPath); } catch (_) {}
      }

      logger.info({ jobId, slideIndex: i + 1, hasBg: !!bgPath }, "Carousel slide rendered");
      return filename;
    })
  );

  const generated = results.flatMap(r => {
    if (r.status === "fulfilled") return [r.value];
    logger.warn({ jobId, err: (r as PromiseRejectedResult).reason }, "Failed to render carousel slide — skipping");
    return [];
  });

  if (brand?.carouselEndSlidePath && fs.existsSync(brand.carouselEndSlidePath)) {
    const ext = path.extname(brand.carouselEndSlidePath) || ".png";
    const endSlideFilename = `carousel_${jobId}_end${ext}`;
    const endSlideDest = path.join(CLIPS_DIR, endSlideFilename);
    try {
      fs.copyFileSync(brand.carouselEndSlidePath, endSlideDest);
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
      await execFileAsync(FFMPEG, [
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

  await execFileAsync(FFMPEG, [
    "-ss", startSeconds.toString(),
    "-i", videoPath,
    "-t", (endSeconds - startSeconds).toString(),
    "-vf", portraitCrop,
    "-sn",
    "-c:v", "libx264", "-preset", "fast", "-crf", "23",
    "-c:a", "aac", "-b:a", "128k",
    "-metadata", `title=${title}`,
    "-movflags", "+faststart",
    outputPath, "-y",
  ], { timeout: 300000 });

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
    "-c:v", "libx264", "-preset", "fast", "-crf", "18",
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
  const ctaFilter = `drawtext=text='${outroText}':fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:fontsize=30:fontcolor=white:x=(w-text_w)/2:y=h-th-60:enable='gte(t,${startSec.toFixed(2)})':borderw=3:bordercolor=black@0.8`;

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
  },
): Promise<GeneratedContent> {
  const thumbnailUrl = getThumbnailUrl(youtubeUrl);
  const transcriptText = transcript.map((s) => s.text).join(" ").slice(0, 10000);
  const jobId = options?.jobId ?? 0;

  const brandVoiceNote = options?.brandVoice
    ? `\n\nBRAND VOICE STYLE: ${options.brandVoice}\nApply this voice consistently across all content.`
    : "";

  const brandDocsNote = options?.brandDocuments?.length
    ? `\n\nBRAND REFERENCE DOCUMENTS (use to inform brand voice, terminology, and positioning):\n${options.brandDocuments.join("\n---\n").slice(0, 6000)}`
    : "";

  const ctaNote = options?.contentCta
    ? `\n\nCTA TO APPEND: "${options.contentCta}" — include this as the final call-to-action in all text content pieces.`
    : "";

  // ── Call A: short-form content ──────────────────────────────────────────
  const promptA = `You are a professional content creator. Based on this YouTube video transcript, generate short-form social content.${brandVoiceNote}${brandDocsNote}${ctaNote}

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

    // Load brand outro rotation list (takes priority over single outro / brand shortFormOutroPath)
    let brandOutros: (typeof brandOutrosTable.$inferSelect)[] = [];
    if (job.brandOutroIds) {
      try {
        const ids: number[] = JSON.parse(job.brandOutroIds);
        if (ids.length > 0) {
          const found = await db.select().from(brandOutrosTable).where(inArray(brandOutrosTable.id, ids));
          // Keep the user-defined ordering and filter missing files
          brandOutros = ids
            .map(id => found.find(o => o.id === id))
            .filter((o): o is typeof brandOutrosTable.$inferSelect => !!o && fs.existsSync(o.filePath));
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

    // Step 1: Download or use uploaded local file
    await updateJobStatus(jobId, "downloading");
    let videoPath: string;
    let title: string;
    if (job.localFilePath && fs.existsSync(job.localFilePath)) {
      videoPath = job.localFilePath;
      const rawName = job.youtubeUrl.startsWith("upload://")
        ? job.youtubeUrl.slice(9)
        : path.basename(job.localFilePath);
      title = path.parse(rawName).name.replace(/[_\-]+/g, " ").trim() || "Uploaded Video";
    } else {
      const result = await downloadVideo(job.youtubeUrl, tempDir);
      videoPath = result.videoPath;
      title = result.title;
    }
    await updateJobStatus(jobId, "downloading", { videoTitle: title });
    const videoDuration = await getVideoDuration(videoPath);

    // Step 2: Extract audio and transcribe
    await updateJobStatus(jobId, "transcribing");
    const audioPath = await extractAudio(videoPath, tempDir);
    const transcript = await transcribeAudio(audioPath, videoDuration);
    await db.update(jobsTable).set({ transcript: JSON.stringify(transcript) }).where(eq(jobsTable.id, jobId));

    // Steps 3 & 4: AI clip selection + written content generation run in parallel
    // Both only need the transcript — no reason to wait for one before starting the other
    await updateJobStatus(jobId, "analyzing");

    let insertedClips: (typeof clipsTable.$inferSelect)[] = [];

    const [clipsResult, contentResult] = await Promise.allSettled([
      job.clipCount > 0
        ? selectBestClips(transcript, job.clipCount, videoDuration, clipDuration)
        : Promise.resolve([] as ClipSegment[]),
      generateContent(job.youtubeUrl, title, transcript, {
        brandVoice: brand?.voiceStyle ?? null,
        contentCta: job.contentCta ?? null,
        brandName: brand?.name ?? null,
        brandWebsite: brand?.website ?? null,
        brandDocuments: brandDocumentTexts,
        jobId,
        brand,
        tempDir,
      }),
    ]);

    // Handle clip selection result
    if (clipsResult.status === "rejected") {
      throw clipsResult.reason as Error;
    }
    const clipSegments = clipsResult.value;
    if (job.clipCount > 0 && clipSegments.length === 0) {
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
            if (bo.ctaText) {
              await prepareOutroWithCta(bo.filePath, bo.ctaText, null, preparedPath);
            } else {
              fs.copyFileSync(bo.filePath, preparedPath);
            }
            preparedBrandOutros.push({ path: preparedPath, id: bo.id });
          } catch (e) {
            logger.warn({ e, outroId: bo.id }, "Failed to prepare brand outro — skipping");
          }
        }
        logger.info({ jobId, count: preparedBrandOutros.length }, "Brand outros prepared for rotation");
      }

      // Single-source fallback (brand shortFormOutroPath or global outro)
      let singleOutroPath: string | null = null;
      let singleOutroPosition = "end";
      if (preparedBrandOutros.length === 0) {
        if (brand?.shortFormOutroPath && fs.existsSync(brand.shortFormOutroPath)) {
          singleOutroPath = brand.shortFormOutroPath;
          singleOutroPosition = "end";
          logger.info({ jobId }, "Using brand short-form outro video");
        } else if (outro) {
          singleOutroPath = path.join(tempDir, "outro_cta.mp4");
          singleOutroPosition = outro.position;
          await prepareOutroWithCta(
            outro.filePath,
            outro.ctaText ?? null,
            outro.ctaStartSeconds ? parseFloat(outro.ctaStartSeconds) : null,
            singleOutroPath,
          );
        }
      }

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
            );

            // Name the final file using the clip's AI-generated title for easy identification
            const safeTitle = sanitizeFilename(clip.title);
            const finalPath = path.join(CLIPS_DIR, `${safeTitle}_${clip.id}.mp4`);

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

            await db.update(clipsTable).set({
              status: "completed",
              filePath: finalPath,
            }).where(eq(clipsTable.id, clip.id));

            logger.info({ clipId: clip.id, title: clip.title }, "Clip rendered successfully");
          } catch (clipErr) {
            logger.error({ clipId: clip.id, err: clipErr }, "Failed to render clip");
            await db.update(clipsTable).set({ status: "failed" }).where(eq(clipsTable.id, clip.id));
          }
        }));
      }

      // Steps 6 & 7: Facebook square video + podcast audio run in parallel — both only need the source video
      const step67Label = wantPodcast ? "Rendering Facebook video & podcast audio…" : "Rendering Facebook video…";
      await updateJobStatus(jobId, "rendering", { errorMessage: step67Label });
      await Promise.allSettled([
        (async () => {
          try {
            const facebookPath = path.join(CLIPS_DIR, `job_${jobId}_facebook.mp4`);
            await renderFullFacebookVideo(videoPath, jobId, transcript, facebookPath);
            logger.info({ jobId }, "Full Facebook 1:1 video rendered");
          } catch (fbErr) {
            logger.warn({ jobId, err: fbErr }, "Full Facebook video render failed — skipping");
          }
        })(),
        (async () => {
          if (!wantPodcast) { logger.info({ jobId }, "Podcast generation skipped (disabled)"); return; }
          try {
            await generatePodcastAudio(jobId, videoPath, brand);
          } catch (podErr) {
            logger.warn({ jobId, err: podErr }, "Podcast generation failed — skipping");
          }
        })(),
      ]);
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
