import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";
import os from "os";
import { db, jobsTable, clipsTable, outrosTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { openai } from "@workspace/integrations-openai-ai-server";
import { logger } from "./logger";

const execFileAsync = promisify(execFile);

// Use the locally-downloaded yt-dlp binary (kept up-to-date) preferring it
// over the older system/Nix version to stay compatible with YouTube changes.
const YTDLP = fs.existsSync("/home/runner/workspace/bin/yt-dlp")
  ? "/home/runner/workspace/bin/yt-dlp"
  : "yt-dlp";

const CLIPS_DIR = path.join(process.cwd(), "clips");
fs.mkdirSync(CLIPS_DIR, { recursive: true });

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
    // android_vr client returns formats without requiring PO tokens or SABR streaming
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
    // Strip any inline SRT html tags (e.g. <i>, <b>)
    const text = lines.slice(timeIdx + 1).join(" ").replace(/<[^>]+>/g, "").trim();
    if (!text || end <= start) continue;
    segments.push({ start, end, text });
  }
  return segments;
}

async function transcribeAudio(audioPath: string, videoDuration: number): Promise<TranscriptSegment[]> {
  const audioBuffer = fs.readFileSync(audioPath);
  const audioFile = new File([audioBuffer], "audio.mp3", { type: "audio/mp3" });

  // SRT format returns real per-segment timestamps — most reliable for caption sync.
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

  // Fallback: plain json gives only raw text, so we estimate timing from sentence structure.
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

  // Split on sentence/clause boundaries for natural caption breaks,
  // then assign duration proportional to character count per segment.
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

function makeFallbackClips(clipCount: number, videoDuration: number): ClipSegment[] {
  // Evenly space clips across the video as a last resort; target ~90s each
  const clipDuration = Math.min(90, Math.floor(videoDuration / (clipCount + 1)));
  const step = videoDuration / (clipCount + 1);
  return Array.from({ length: clipCount }, (_, i) => ({
    title: `HIGHLIGHT CLIP ${i + 1}`,
    startSeconds: Math.max(0, step * (i + 1) - clipDuration / 2),
    endSeconds: Math.min(videoDuration, step * (i + 1) + clipDuration / 2),
    reasoning: "Fallback evenly-spaced clip",
  }));
}

async function selectBestClips(transcript: TranscriptSegment[], clipCount: number, videoDuration: number): Promise<ClipSegment[]> {
  const transcriptText = transcript
    .map((s) => `[${s.start.toFixed(1)}s - ${s.end.toFixed(1)}s]: ${s.text}`)
    .join("\n");

  const prompt = `You are an expert short-form video editor. Analyze this transcript and select the ${clipCount} best segments for standalone social media clips.

TRANSCRIPT (with timestamps):
${transcriptText}

VIDEO DURATION: ${videoDuration.toFixed(0)} seconds

Requirements:
- Duration: 60 to 120 seconds each — clips MUST be at least 1 minute long so they stand alone as complete content
- Self-contained: viewer must understand the clip with zero context from the rest of the video
- High engagement potential: interesting, funny, insightful, emotional, or surprising
- Start and end at natural speech breaks — never cut mid-sentence
- Prefer segments with a clear narrative arc: setup → development → payoff
- Avoid intros/outros, filler, incomplete thoughts, or clips shorter than 60 seconds

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
    logger.info({ jobId: "unknown", aiResponse: content.slice(0, 300) }, "AI clip selection response");

    // Try to extract a JSON array from anywhere in the response
    const arrayMatch = content.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      const parsed = JSON.parse(arrayMatch[0]) as ClipSegment[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }

    // Try extracting from an object with a "clips" key
    const objMatch = content.match(/\{[\s\S]*\}/);
    if (objMatch) {
      const obj = JSON.parse(objMatch[0]) as { clips?: ClipSegment[] };
      if (Array.isArray(obj.clips) && obj.clips.length > 0) {
        return obj.clips;
      }
    }

    logger.warn({ content: content.slice(0, 200) }, "AI returned no clips, using fallback");
  } catch (e) {
    logger.warn({ e }, "AI clip selection failed, using fallback");
  }

  return makeFallbackClips(clipCount, videoDuration);
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
    .replace(/'/g, "")        // Remove apostrophes — they break ffmpeg single-quote escaping
    .replace(/:/g, "\\:")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/,/g, "\\,");
}

const LOGO_PATH = path.join(process.cwd(), "src", "assets", "taw-logo.png");
const POPPINS_BOLD_PATH = path.join(process.cwd(), "src", "assets", "fonts", "Poppins-Bold.ttf");
const DEJAVU_BOLD_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";

async function renderMainClip(
  videoPath: string,
  clipId: number,
  title: string,
  startSeconds: number,
  endSeconds: number,
  _transcript: TranscriptSegment[],
  outputPath: string,
): Promise<void> {
  // Portrait crop: scale so the video fills 1080×1920 (centre-crop).
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
}

function formatSrtTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")},${ms.toString().padStart(3, "0")}`;
}

function transcriptToSrt(transcript: TranscriptSegment[]): string {
  // Sort and de-overlap then write as SRT
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

  // Write SRT subtitle file (captions ALL CAPS, word-wrapped at ~30 chars)
  const srtPath = path.join(CLIPS_DIR, `job_${jobId}_facebook.srt`);
  fs.writeFileSync(srtPath, transcriptToSrt(transcript), "utf8");

  // ASS override: white Poppins Bold, black outline, bottom-centre, 60px margin from bottom
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
    ], { timeout: 3600000 }); // 1-hour timeout for long full-video renders
  } finally {
    try { fs.unlinkSync(srtPath); } catch (_) {}
  }
}

async function renderQuoteImages(
  videoPath: string,
  jobId: number,
  clips: Array<{ startSeconds: number; endSeconds: number }>,
  quotes: string[],
): Promise<string[]> {
  const imageFilenames: string[] = [];
  const fontFile = fs.existsSync(POPPINS_BOLD_PATH) ? POPPINS_BOLD_PATH : DEJAVU_BOLD_PATH;

  for (let i = 0; i < Math.min(quotes.length, 4); i++) {
    try {
      const clip = clips[i % Math.max(1, clips.length)];
      // Pick a frame from 40% through the clip — typically mid-speech with speaker visible
      const timestamp = clip.startSeconds + (clip.endSeconds - clip.startSeconds) * 0.4;

      const filename = `quote_img_${jobId}_${i}.jpg`;
      const outputPath = path.join(CLIPS_DIR, filename);

      // Word-wrap at ~30 chars per line — wider wrap = fewer lines = larger font
      const words = quotes[i].replace(/[^\w\s'.,!?-]/g, "").toUpperCase().split(/\s+/).filter(Boolean);
      const lines: string[] = [];
      let currentLine = "";
      for (const word of words) {
        if ((currentLine + " " + word).trim().length > 30) {
          if (currentLine) lines.push(currentLine.trim());
          currentLine = word;
        } else {
          currentLine = (currentLine + " " + word).trim();
        }
      }
      if (currentLine) lines.push(currentLine.trim());

      const nLines = lines.length;
      // Dark box: bottom half of the 1080×1080 frame — gives ample vertical room
      const darkY = 540;
      const darkH = 540;
      const padV = 24; // vertical padding inside the dark band (top + bottom)
      const lineSpacing = 10;
      const availH = darkH - padV * 2;

      // Pick the largest font size where all lines still fit within the available height
      // Total text height = nLines * fontSize + (nLines - 1) * lineSpacing
      // We solve for fontSize: fontSize = (availH - (nLines-1)*lineSpacing) / nLines
      const fontSize = Math.max(24, Math.min(42, Math.floor((availH - (nLines - 1) * lineSpacing) / nLines)));

      // Compute exact y start position in pixels (no reliance on ffmpeg's 'th' variable)
      const textHeight = nLines * fontSize + (nLines - 1) * lineSpacing;
      const textY = darkY + padV + Math.floor((availH - textHeight) / 2);

      const quoteText = escapeFfmpegText(lines.join("\\n"));

      await execFileAsync("ffmpeg", [
        "-ss", timestamp.toFixed(2),
        "-i", videoPath,
        "-vframes", "1",
        "-vf", [
          // 1:1 square crop — 1080×1080
          "scale=1080:1080:force_original_aspect_ratio=increase,crop=1080:1080",
          // Semi-transparent dark box covering the bottom half
          `drawbox=x=0:y=${darkY}:w=iw:h=${darkH}:color=black@0.78:t=fill`,
          // Quote text ALL CAPS — font size chosen to fit all lines inside the dark band
          `drawtext=fontfile=${fontFile}:text='${quoteText}':fontcolor=white:fontsize=${fontSize}:x=(w-text_w)/2:y=${textY}:line_spacing=${lineSpacing}:borderw=3:bordercolor=black@0.55`,
        ].join(","),
        "-q:v", "2",
        outputPath, "-y",
      ], { timeout: 60000 });

      imageFilenames.push(filename);
      logger.info({ jobId, quoteIndex: i, filename }, "Quote image rendered");
    } catch (err) {
      logger.warn({ jobId, quoteIndex: i, err }, "Failed to render quote image — skipping");
    }
  }

  return imageFilenames;
}

async function prepareOutroWithCta(
  outroFilePath: string,
  ctaText: string | null,
  ctaStartSeconds: number | null,
  outputPath: string,
): Promise<void> {
  if (!ctaText || ctaText.trim() === "") {
    // No CTA — just re-encode the outro to match specs
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
  // Get dimensions of main clip to scale outro to match
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "quiet", "-print_format", "json", "-show_streams",
    "-select_streams", "v:0", mainClipPath,
  ], { timeout: 30000 });

  const info = JSON.parse(stdout);
  const stream = info.streams?.[0];
  const width = stream?.width || 1280;
  const height = stream?.height || 720;

  // Scale outro to match main clip dimensions
  const scaledOutroPath = path.join(tempDir, "outro_scaled.mp4");
  await execFileAsync("ffmpeg", [
    "-i", outroPath,
    "-vf", `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black`,
    "-c:v", "libx264", "-preset", "fast", "-crf", "23",
    "-c:a", "aac", "-b:a", "128k",
    "-movflags", "+faststart",
    scaledOutroPath, "-y",
  ], { timeout: 120000 });

  // Create concat list
  const concatListPath = path.join(tempDir, "concat_list.txt");
  let concatContent: string;
  if (position === "beginning") {
    concatContent = `file '${scaledOutroPath}'\nfile '${mainClipPath}'\n`;
  } else {
    concatContent = `file '${mainClipPath}'\nfile '${scaledOutroPath}'\n`;
  }
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
}): string {
  const { videoTitle, thumbnailUrl, youtubeUrl, intro, sections, cta } = params;

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

  return [
    `<div style="max-width:600px;margin:0 auto;font-family:Georgia,serif;color:#1a1a1a;line-height:1.8;font-size:15px">`,
    thumbnailUrl ? `<img src="${thumbnailUrl}" alt="${videoTitle}" style="width:100%;height:auto;margin-bottom:24px;display:block" />` : "",
    `<p style="margin:0 0 14px">Hey!</p>`,
    `<p style="margin:0 0 14px">${intro}</p>`,
    sectionsHtml,
    `<p style="margin:24px 0 14px">${cta}</p>`,
    `<p style="margin:0 0 14px">Watch the full video here: <a href="${youtubeUrl}" style="color:#f21178">${youtubeUrl}</a></p>`,
    `<p style="margin:24px 0 4px">Speak soon,</p>`,
    `<p style="margin:0">Dan &amp; The TAW Media Team</p>`,
    `</div>`,
  ].join("");
}

export async function generateContent(
  youtubeUrl: string,
  videoTitle: string,
  transcript: TranscriptSegment[],
): Promise<GeneratedContent> {
  const thumbnailUrl = getThumbnailUrl(youtubeUrl);
  const transcriptText = transcript.map((s) => s.text).join(" ").slice(0, 10000);

  // ── Call A: short-form content (quotes, captions, newsletter, thread) ─────────
  const promptA = `You are a professional content creator for TAW Media. Based on this YouTube video transcript, generate short-form social media content.

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
    "Instagram/TikTok caption for Quote 1. Hook line that grabs attention. 3-4 first-person story paragraphs elaborating on the quote theme using real insights from the video. Open question to prompt comments. 8-10 relevant hashtags on their own line. CTA line (e.g. 'Comment BRAIN below and I will DM you the free guide.'). 250-350 words total.",
    "Instagram/TikTok caption for Quote 2. Same structure — hook, story paragraphs, question, hashtags, CTA. Different angle from Quote 2.",
    "Instagram/TikTok caption for Quote 3. Same structure. Different angle.",
    "Instagram/TikTok caption for Quote 4. Same structure. Different angle.",
    "Instagram/TikTok caption for Quote 5. Same structure. Different angle."
  ],
  "threadPosts": [
    "Hook — the single most compelling insight from the video. Start with the insight, no preamble. Max 280 chars.",
    "Key insight from the video. Start directly with the content. Max 280 chars.",
    "Another insight or tactical tip. Max 280 chars.",
    "Practical action step the viewer can use immediately. Max 280 chars.",
    "Wrap-up inviting people to watch the full video — include the URL: ${youtubeUrl}. Max 280 chars."
  ],
  "newsletterSubject": "Compelling email subject line. Max 60 chars. No clickbait.",
  "newsletterIntro": "3-4 sentences written after 'Hey!' — jump straight into what this video is about and why the reader needs to see it. Write exactly like Dan from The Aspie World: direct, upbeat, no corporate fluff, slightly cheeky, speaks to the neurodivergent community like a mate who gets it. Short punchy sentences. Do NOT start with 'Hey' — that is already in the template.",
  "newsletterSections": [
    {
      "heading": "First section heading — the core problem or context from the video",
      "body": "2-3 sentences explaining the key concept, why conventional wisdom fails, and what the video reveals.",
      "subItems": []
    },
    {
      "heading": "Second section heading — the solution or framework taught in the video",
      "body": "1-2 sentences framing the approach and why it works.",
      "subItems": [
        { "label": "Step or Day 1 label", "description": "What this step involves and its specific action or outcome." },
        { "label": "Step or Day 2 label", "description": "What this step involves and its specific action or outcome." },
        { "label": "Step or Day 3 label", "description": "What this step involves and its specific action or outcome." }
      ]
    }
  ],
  "newsletterCta": "2-3 sentences of enthusiastic closing that describes what the reader will gain from watching the full video. No button — plain text only."
}`;

  // ── Call B: long-form content (blog + article) ─────────────────────────────
  const promptB = `You are a professional content creator for TAW Media. Based on this YouTube video transcript, generate long-form written content.

VIDEO TITLE: ${videoTitle}
VIDEO URL: ${youtubeUrl}

TRANSCRIPT:
${transcriptText}

Return ONLY a valid JSON object with these exact keys — no markdown fences, no explanation:

{
  "blogPost": "SEO-OPTIMISED HTML BLOG POST. OUTPUT RULES: plain HTML only — no markdown, no code fences. ALLOWED TAGS: <h1> <h2> <h3> <p> <strong> <em> <ul> <li> only. No classes, no styles, no divs. SEO: identify 2-3 primary keywords; place them in the <h1>, in at least two <h2>s, and throughout the body. STRUCTURE in order: (1) <h1> SEO title. (2) 2-3 <p> opening hook paragraphs. (3) 6-8 <h2> sections each with 2-3 <p> body paragraphs; use <h3> for step or day sub-sections followed by a <ul><li> list. (4) LAST element: <p><strong>TL;DR:</strong> 3-4 sentence summary</p>. TARGET: minimum 1500 words.",
  "socialArticle": "HTML article for Facebook, Quora, LinkedIn. ALLOWED TAGS: <h2> <p> <strong> <em> <ul> <li> only. No classes, no styles, no divs. TARGET: 500 words. STRUCTURE: <p> hook with <strong> emphasis. 2-3 <h2> sections with 1-2 <p> each. One <ul><li> list of 3-5 points where natural. Final <p> ending ONLY with: 'FREE autism life hacks book — link in comments.' No video URL, no other links."
}`;

  // Run both calls in parallel
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

  const newsletterHtml = buildNewsletterHtml({
    videoTitle,
    thumbnailUrl,
    youtubeUrl,
    intro: (a.newsletterIntro as string) ?? "",
    sections: Array.isArray(a.newsletterSections) ? (a.newsletterSections as NewsletterSection[]) : [],
    cta: (a.newsletterCta as string) ?? "",
  });

  return {
    videoTitle,
    thumbnailUrl,
    youtubeUrl,
    blogPost: (b.blogPost as string) ?? "",
    threadPosts: Array.isArray(a.threadPosts) ? (a.threadPosts as string[]) : [],
    socialArticle: (b.socialArticle as string) ?? "",
    newsletterEmail: {
      subject: (a.newsletterSubject as string) ?? "",
      body: newsletterHtml,
    },
    quotes: Array.isArray(a.quotes) ? (a.quotes as string[]).slice(0, 5) : [],
    quoteImages: [],
    instagramCaptions: Array.isArray(a.instagramCaptions) ? (a.instagramCaptions as string[]).slice(0, 5) : [],
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

    // Step 1: Download
    await updateJobStatus(jobId, "downloading");
    const { videoPath, title } = await downloadVideo(job.youtubeUrl, tempDir);
    await updateJobStatus(jobId, "downloading", { videoTitle: title });
    const videoDuration = await getVideoDuration(videoPath);

    // Step 2: Extract audio and transcribe
    await updateJobStatus(jobId, "transcribing");
    const audioPath = await extractAudio(videoPath, tempDir);
    const transcript = await transcribeAudio(audioPath, videoDuration);
    // Persist transcript so content can be regenerated later without re-downloading
    await db.update(jobsTable).set({ transcript: JSON.stringify(transcript) }).where(eq(jobsTable.id, jobId));

    // Step 3: AI clip selection
    await updateJobStatus(jobId, "analyzing");
    const clipSegments = await selectBestClips(transcript, job.clipCount, videoDuration);

    if (clipSegments.length === 0) {
      throw new Error("No clip segments were selected — the video may be too short or have no audio");
    }

    const insertedClips = await db.insert(clipsTable).values(
      clipSegments.map((seg) => ({
        jobId,
        title: seg.title,
        startSeconds: seg.startSeconds.toString(),
        endSeconds: seg.endSeconds.toString(),
        durationSeconds: (seg.endSeconds - seg.startSeconds).toString(),
        status: "pending",
      }))
    ).returning();

    // Step 4: Generate written content (non-fatal — job completes even if this fails)
    try {
      const content = await generateContent(job.youtubeUrl, title, transcript);
      await db.update(jobsTable).set({ generatedContent: JSON.stringify(content) }).where(eq(jobsTable.id, jobId));
      logger.info({ jobId }, "Content generation completed");
    } catch (contentErr) {
      logger.warn({ jobId, err: contentErr }, "Content generation failed — rendering will continue");
    }

    // Step 5: Render clips
    await updateJobStatus(jobId, "rendering");

    // Pre-render outro (with CTA) if needed — do once, reuse for all clips
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

    // Step 6: Render full Facebook 1:1 video (non-fatal — runs after clips so it doesn't block them)
    try {
      const facebookPath = path.join(CLIPS_DIR, `job_${jobId}_facebook.mp4`);
      logger.info({ jobId }, "Starting full Facebook 1:1 video render");
      await renderFullFacebookVideo(videoPath, jobId, transcript, facebookPath);
      logger.info({ jobId }, "Full Facebook 1:1 video rendered successfully");
    } catch (fbErr) {
      logger.warn({ jobId, err: fbErr }, "Full Facebook video render failed — skipping");
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
