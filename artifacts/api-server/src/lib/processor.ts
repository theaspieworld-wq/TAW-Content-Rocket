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

async function transcribeAudio(audioPath: string, videoDuration: number): Promise<TranscriptSegment[]> {
  const audioBuffer = fs.readFileSync(audioPath);
  const audioFile = new File([audioBuffer], "audio.mp3", { type: "audio/mp3" });
  // gpt-4o-mini-transcribe only supports 'json' format — no per-segment timestamps
  // We estimate timing by spreading words evenly across the video duration
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

  const words = rawText.trim().split(/\s+/);
  const totalWords = words.length;
  const duration = Math.max(1, videoDuration);

  // Group words into ~4-second caption chunks based on even word distribution
  const wordsPerSec = totalWords / duration;
  const chunkSize = Math.max(5, Math.round(wordsPerSec * 4));

  const segments: TranscriptSegment[] = [];
  for (let i = 0; i < totalWords; i += chunkSize) {
    const chunk = words.slice(i, Math.min(i + chunkSize, totalWords));
    const start = (i / totalWords) * duration;
    const end = (Math.min(i + chunkSize, totalWords) / totalWords) * duration;
    segments.push({ start, end, text: chunk.join(" ") });
  }
  return segments;
}

function makeFallbackClips(clipCount: number, videoDuration: number): ClipSegment[] {
  // Evenly space clips across the video as a last resort
  const clipDuration = Math.min(30, Math.floor(videoDuration / (clipCount + 1)));
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

  const prompt = `You are an expert short-form video editor. Analyze this transcript and select the ${clipCount} best segments for short-form social media videos.

TRANSCRIPT (with timestamps):
${transcriptText}

VIDEO DURATION: ${videoDuration.toFixed(0)} seconds

Requirements:
- Duration: 15 to 60 seconds each
- Self-contained, makes sense without context
- High engagement potential: interesting, funny, insightful, emotional, or surprising
- Start and end at natural speech breaks
- Prefer segments with clear narrative arc, key insight, or strong hook
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

async function renderMainClip(
  videoPath: string,
  clipId: number,
  title: string,
  startSeconds: number,
  endSeconds: number,
  transcript: TranscriptSegment[],
  outputPath: string,
): Promise<void> {
  const clipSegments = transcript.filter((s) => s.end > startSeconds && s.start < endSeconds);
  const captionFilters: string[] = [];

  for (const seg of clipSegments) {
    const segStart = Math.max(0, seg.start - startSeconds);
    const segEnd = Math.min(endSeconds - startSeconds, seg.end - startSeconds);
    if (segEnd <= segStart) continue;

    // Wrap caption lines — narrower limit for portrait 9:16 frame
    const words = seg.text.trim().toUpperCase().split(" ");
    const lines: string[] = [];
    let currentLine = "";
    for (const word of words) {
      if ((currentLine + " " + word).trim().length > 22) {
        if (currentLine) lines.push(currentLine.trim());
        currentLine = word;
      } else {
        currentLine = (currentLine + " " + word).trim();
      }
    }
    if (currentLine) lines.push(currentLine.trim());

    const captionText = escapeFfmpegText(lines.join("\\n"));
    // Escape commas inside between() so they aren't parsed as filter separators
    const enableExpr = `between(t\\,${segStart.toFixed(2)}\\,${segEnd.toFixed(2)})`;
    // Bottom-third captions: y=h-th-200 keeps them well within the 9:16 safe area
    captionFilters.push(
      `drawtext=text='${captionText}':fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:fontsize=52:fontcolor=white:x=(w-text_w)/2:y=h-th-200:enable=${enableExpr}:borderw=4:bordercolor=black@0.85:line_spacing=8`
    );
  }

  // Use filter_complex so we can overlay the logo PNG (with alpha) on top of the video.
  // Chain: crop → scale 1080×1920 → overlay logo centred at top → captions
  const logoExists = fs.existsSync(LOGO_PATH);
  let filterComplex: string;

  if (logoExists) {
    if (captionFilters.length > 0) {
      filterComplex = [
        `[0:v]crop=in_h*9/16:in_h:(in_w-in_h*9/16)/2:0,scale=1080:1920[bg]`,
        `[1:v]scale=280:-1[logo]`,
        `[bg][logo]overlay=x=(W-w)/2:y=30[base]`,
        `[base]${captionFilters.join(",")}[v]`,
      ].join(";");
    } else {
      filterComplex = [
        `[0:v]crop=in_h*9/16:in_h:(in_w-in_h*9/16)/2:0,scale=1080:1920[bg]`,
        `[1:v]scale=280:-1[logo]`,
        `[bg][logo]overlay=x=(W-w)/2:y=30[v]`,
      ].join(";");
    }

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
      "-movflags", "+faststart",
      outputPath, "-y",
    ], { timeout: 300000 });
  } else {
    // Fallback: no logo, just crop/scale + captions via -vf
    const allFilters = [
      "crop=in_h*9/16:in_h:(in_w-in_h*9/16)/2:0",
      "scale=1080:1920",
      ...captionFilters,
    ].join(",");
    await execFileAsync("ffmpeg", [
      "-ss", startSeconds.toString(),
      "-i", videoPath,
      "-t", (endSeconds - startSeconds).toString(),
      "-vf", allFilters,
      "-c:v", "libx264", "-preset", "fast", "-crf", "23",
      "-c:a", "aac", "-b:a", "128k",
      "-movflags", "+faststart",
      outputPath, "-y",
    ], { timeout: 300000 });
  }
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

function buildNewsletterHtml(params: {
  videoTitle: string;
  thumbnailUrl: string;
  youtubeUrl: string;
  greeting: string;
  takeaways: string[];
  closing: string;
}): string {
  const { videoTitle, thumbnailUrl, youtubeUrl, greeting, takeaways, closing } = params;
  const items = takeaways.map((t) => `<li style="margin-bottom:8px">${t}</li>`).join("");
  return [
    `<div style="max-width:600px;margin:0 auto;font-family:Arial,'Helvetica Neue',sans-serif;color:#1a1a1a;line-height:1.7">`,
    `<img src="${thumbnailUrl}" alt="${videoTitle}" style="width:100%;height:auto;border-radius:8px;margin-bottom:24px;display:block" />`,
    `<h1 style="font-size:22px;font-weight:700;margin:0 0 20px;color:#0d0d0d">${videoTitle}</h1>`,
    `<p>Hi [First Name],</p>`,
    `<p>${greeting}</p>`,
    `<h2 style="font-size:17px;font-weight:700;margin:24px 0 10px;color:#0d0d0d">Key Takeaways</h2>`,
    `<ul style="padding-left:20px;margin:0 0 24px">${items}</ul>`,
    `<p>${closing}</p>`,
    `<a href="${youtubeUrl}" style="display:inline-block;background:#f21178;color:#ffffff;padding:13px 30px;text-decoration:none;border-radius:6px;font-weight:700;font-size:15px;margin:8px 0 28px">Watch the Full Video</a>`,
    `<p style="color:#666;font-size:14px;border-top:1px solid #eee;padding-top:20px;margin-top:8px">Best,<br>The TAW Media Team</p>`,
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

  const prompt = `You are a professional content creator for TAW Media. Based on this YouTube video transcript, generate content for four formats.

VIDEO TITLE: ${videoTitle}
VIDEO URL: ${youtubeUrl}

TRANSCRIPT:
${transcriptText}

Return ONLY a valid JSON object with these exact keys — no markdown fences, no explanation:

{
  "blogPost": "Full HTML blog post ready to paste into any CMS or blog editor. Use proper HTML tags: <h1> for the title, <h2> for section headings, <p> for paragraphs, <strong> for bold emphasis, <em> for italics, <ul>/<li> for lists. Structure: <h1>[Title]</h1>, <h2>Introduction</h2>, <h2>[3-4 thematic section headings from the transcript]</h2>, <h2>Conclusion</h2>, <h2>TL;DR</h2> (2-3 sentence summary — always at the very end). No inline styles. Target 700-900 words.",
  "threadPosts": [
    "Hook — the single most compelling insight from the video. Start with the insight itself, no label or preamble. Max 280 chars.",
    "Key insight from the video. Start directly with the content, no label or preamble. Max 280 chars.",
    "Another insight or tactical tip. Start directly with the content, no label or preamble. Max 280 chars.",
    "Practical action step the viewer can use immediately. Start directly with the content, no label or preamble. Max 280 chars.",
    "Wrap-up inviting people to watch the full video — include the URL: ${youtubeUrl}. Start directly with the content, no label or preamble. Max 280 chars."
  ],
  "socialArticle": "Professional article for Facebook, Quora, and LinkedIn. 4-5 paragraphs. Open with a strong statement or question. Deliver real value from the transcript. End the final paragraph with: Watch the full video here: ${youtubeUrl}",
  "newsletterSubject": "Compelling email subject line. Max 60 chars. No clickbait.",
  "newsletterGreeting": "Opening paragraph after 'Hi [First Name],' — 2-3 sentences that explain what this video covers and why it matters to the reader.",
  "newsletterTakeaways": ["Key takeaway 1", "Key takeaway 2", "Key takeaway 3"],
  "newsletterClosing": "One paragraph closing that builds anticipation for the video and encourages clicking the button below.",
  "quotes": [
    "Powerful verbatim or near-verbatim quote from the transcript. Max 200 chars. No attribution needed.",
    "Second quote — different theme or insight. Max 200 chars.",
    "Third quote — emotionally resonant or thought-provoking. Max 200 chars.",
    "Fourth quote — actionable or memorable. Max 200 chars."
  ]
}`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    max_completion_tokens: 4000,
  });

  const rawContent = response.choices[0]?.message?.content ?? "{}";
  const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("AI returned no valid JSON for content generation");

  const g = JSON.parse(jsonMatch[0]);

  const newsletterHtml = buildNewsletterHtml({
    videoTitle,
    thumbnailUrl,
    youtubeUrl,
    greeting: g.newsletterGreeting ?? "",
    takeaways: Array.isArray(g.newsletterTakeaways) ? g.newsletterTakeaways : [],
    closing: g.newsletterClosing ?? "",
  });

  return {
    videoTitle,
    thumbnailUrl,
    youtubeUrl,
    blogPost: g.blogPost ?? "",
    threadPosts: Array.isArray(g.threadPosts) ? g.threadPosts : [],
    socialArticle: g.socialArticle ?? "",
    newsletterEmail: {
      subject: g.newsletterSubject ?? "",
      body: newsletterHtml,
    },
    quotes: Array.isArray(g.quotes) ? g.quotes.slice(0, 4) : [],
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
