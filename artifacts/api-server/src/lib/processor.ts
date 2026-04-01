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

async function transcribeAudio(audioPath: string): Promise<TranscriptSegment[]> {
  const audioBuffer = fs.readFileSync(audioPath);
  const audioFile = new File([audioBuffer], "audio.mp3", { type: "audio/mp3" });
  const response = await openai.audio.transcriptions.create({
    model: "gpt-4o-mini-transcribe",
    file: audioFile,
    response_format: "json",
    timestamp_granularities: ["segment"],
  } as Parameters<typeof openai.audio.transcriptions.create>[0]);

  const result = response as unknown as { segments?: { start: number; end: number; text: string }[]; text?: string };
  if (result.segments && result.segments.length > 0) {
    return result.segments.map((s) => ({ start: s.start, end: s.end, text: s.text }));
  }
  const fullText = result.text || (response as unknown as string);
  return [{ start: 0, end: 60, text: typeof fullText === "string" ? fullText : "" }];
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
    .replace(/'/g, "\\'")
    .replace(/:/g, "\\:")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/,/g, "\\,");
}

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

    const words = seg.text.trim().toUpperCase().split(" ");
    const lines: string[] = [];
    let currentLine = "";
    for (const word of words) {
      if ((currentLine + " " + word).trim().length > 35) {
        if (currentLine) lines.push(currentLine.trim());
        currentLine = word;
      } else {
        currentLine = (currentLine + " " + word).trim();
      }
    }
    if (currentLine) lines.push(currentLine.trim());

    const captionText = escapeFfmpegText(lines.join("\\n"));
    captionFilters.push(
      `drawtext=text='${captionText}':fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:fontsize=28:fontcolor=white:x=(w-text_w)/2:y=h-th-60:enable='between(t,${segStart.toFixed(2)},${segEnd.toFixed(2)})':borderw=2:bordercolor=black@0.7`
    );
  }

  const titleText = escapeFfmpegText(title.toUpperCase());
  const allFilters = [
    `drawbox=x=0:y=0:w=iw:h=80:color=white:t=fill`,
    `drawtext=text='${titleText}':fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:fontsize=26:fontcolor=black:x=(w-text_w)/2:y=25:box=0`,
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
    const transcript = await transcribeAudio(audioPath);

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

    // Step 4: Render clips
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
