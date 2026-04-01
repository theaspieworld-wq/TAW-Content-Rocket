import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";
import os from "os";
import { db, jobsTable, clipsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { openai } from "@workspace/integrations-openai-ai-server";
import { logger } from "./logger";

const execFileAsync = promisify(execFile);

const CLIPS_DIR = path.join(process.cwd(), "clips");

// Ensure clips directory exists
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
  // Get video info first
  const infoArgs = [
    "--print", "%(title)s",
    "--no-playlist",
    youtubeUrl
  ];

  let title = "Untitled Video";
  try {
    const { stdout } = await execFileAsync("yt-dlp", infoArgs, { timeout: 30000 });
    title = stdout.trim().split("\n")[0] || title;
  } catch (e) {
    logger.warn({ e }, "Could not fetch video title");
  }

  const videoPath = path.join(outputDir, "video.mp4");

  // Download video - prefer a reasonable quality to keep file sizes manageable
  const dlArgs = [
    "--no-playlist",
    "-f", "bestvideo[ext=mp4][height<=720]+bestaudio[ext=m4a]/best[ext=mp4][height<=720]/best[height<=720]/best",
    "--merge-output-format", "mp4",
    "-o", videoPath,
    "--limit-rate", "5M",
    youtubeUrl
  ];

  await execFileAsync("yt-dlp", dlArgs, { timeout: 300000 });

  if (!fs.existsSync(videoPath)) {
    throw new Error("Video download failed — output file not found");
  }

  return { videoPath, title };
}

async function extractAudio(videoPath: string, outputDir: string): Promise<string> {
  const audioPath = path.join(outputDir, "audio.mp3");
  await execFileAsync("ffmpeg", [
    "-i", videoPath,
    "-vn",
    "-ar", "16000",
    "-ac", "1",
    "-b:a", "64k",
    audioPath,
    "-y"
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
    return result.segments.map((s) => ({
      start: s.start,
      end: s.end,
      text: s.text,
    }));
  }

  // Fallback: return as single segment if no timestamps
  const fullText = result.text || (response as unknown as string);
  return [{ start: 0, end: 60, text: typeof fullText === "string" ? fullText : "" }];
}

async function selectBestClips(transcript: TranscriptSegment[], clipCount: number, videoDuration: number): Promise<ClipSegment[]> {
  const transcriptText = transcript
    .map((s) => `[${s.start.toFixed(1)}s - ${s.end.toFixed(1)}s]: ${s.text}`)
    .join("\n");

  const prompt = `You are an expert short-form video editor. Analyze this video transcript and select the ${clipCount} best segments for short-form social media videos (Reels, TikTok, YouTube Shorts).

TRANSCRIPT (with timestamps):
${transcriptText}

VIDEO DURATION: ${videoDuration.toFixed(0)} seconds

Requirements for each clip:
- Duration: 15 to 60 seconds
- Must be self-contained and make sense without context
- Should have high engagement potential: interesting, funny, insightful, emotional, or surprising
- Start and end at natural speech breaks (complete sentences)
- Prefer segments with clear narrative arc, key insight, or strong hook
- Avoid intros/outros, filler content, or incomplete thoughts

Return ONLY a valid JSON array with exactly ${clipCount} clips in this format:
[
  {
    "title": "ENGAGING TITLE IN ALL CAPS (5-8 words)",
    "startSeconds": 12.5,
    "endSeconds": 45.0,
    "reasoning": "Why this segment works well as a short"
  }
]

Important: Titles should be punchy, hook-oriented, ALL CAPS, max 8 words. Only return the JSON array, no other text.`;

  const response = await openai.chat.completions.create({
    model: "gpt-5-mini",
    max_completion_tokens: 2000,
    messages: [{ role: "user", content: prompt }],
  });

  const content = response.choices[0]?.message?.content || "[]";

  // Extract JSON from response
  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error("AI did not return valid clip selections");
  }

  const clips: ClipSegment[] = JSON.parse(jsonMatch[0]);
  return clips;
}

async function getVideoDuration(videoPath: string): Promise<number> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "quiet",
    "-print_format", "json",
    "-show_format",
    videoPath
  ], { timeout: 30000 });

  const info = JSON.parse(stdout);
  return parseFloat(info.format?.duration || "0");
}

async function renderClip(
  videoPath: string,
  clipId: number,
  title: string,
  startSeconds: number,
  endSeconds: number,
  transcript: TranscriptSegment[]
): Promise<string> {
  const outputPath = path.join(CLIPS_DIR, `clip_${clipId}.mp4`);

  // Filter transcript segments for this clip window
  const clipSegments = transcript.filter(
    (s) => s.end > startSeconds && s.start < endSeconds
  );

  // Build drawtext filters for captions
  const captionFilters: string[] = [];

  if (clipSegments.length > 0) {
    for (const seg of clipSegments) {
      const segStart = Math.max(0, seg.start - startSeconds);
      const segEnd = Math.min(endSeconds - startSeconds, seg.end - startSeconds);

      if (segEnd <= segStart) continue;

      // Split text into chunks of ~35 chars for readability
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

      const captionText = lines.join("\\n");
      // Escape special chars for ffmpeg drawtext
      const escaped = captionText
        .replace(/'/g, "\\'")
        .replace(/:/g, "\\:")
        .replace(/\[/g, "\\[")
        .replace(/\]/g, "\\]");

      captionFilters.push(
        `drawtext=text='${escaped}':fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:fontsize=28:fontcolor=white:x=(w-text_w)/2:y=h-th-60:enable='between(t,${segStart.toFixed(2)},${segEnd.toFixed(2)})':borderw=2:bordercolor=black@0.7`
      );
    }
  }

  // Title bar filter: white background bar at top with black text
  const titleText = title.toUpperCase()
    .replace(/'/g, "\\'")
    .replace(/:/g, "\\:")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]");

  const titleFilter = [
    `drawbox=x=0:y=0:w=iw:h=80:color=white:t=fill`,
    `drawtext=text='${titleText}':fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:fontsize=26:fontcolor=black:x=(w-text_w)/2:y=25:box=0`
  ];

  const allFilters = [...titleFilter, ...captionFilters].join(",");

  const duration = endSeconds - startSeconds;
  const args = [
    "-ss", startSeconds.toString(),
    "-i", videoPath,
    "-t", duration.toString(),
    "-vf", allFilters,
    "-c:v", "libx264",
    "-preset", "fast",
    "-crf", "23",
    "-c:a", "aac",
    "-b:a", "128k",
    "-movflags", "+faststart",
    outputPath,
    "-y"
  ];

  await execFileAsync("ffmpeg", args, { timeout: 300000 });
  return outputPath;
}

export async function processJob(jobId: number): Promise<void> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `job_${jobId}_`));

  try {
    // Get job details
    const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
    if (!job) throw new Error(`Job ${jobId} not found`);

    logger.info({ jobId }, "Starting video processing");

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

    // Insert clip records
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

    for (const clip of insertedClips) {
      try {
        await db.update(clipsTable).set({ status: "rendering" }).where(eq(clipsTable.id, clip.id));

        const outputPath = await renderClip(
          videoPath,
          clip.id,
          clip.title,
          parseFloat(clip.startSeconds),
          parseFloat(clip.endSeconds),
          transcript
        );

        await db.update(clipsTable).set({
          status: "completed",
          filePath: outputPath,
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
    // Clean up temp dir
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (e) {
      logger.warn({ e }, "Failed to clean up temp dir");
    }
  }
}
