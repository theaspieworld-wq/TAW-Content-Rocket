# Workspace

## Overview

YouTube Shorts Generator — pnpm workspace monorepo using TypeScript. Paste a YouTube URL and the app automatically finds the best moments, transcribes, picks segments with AI, and renders short-form clips (15s–60s) with a title overlay and burned-in captions.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (ESM bundle)
- **AI**: OpenAI via Replit AI Integrations (transcription: gpt-4o-mini-transcribe, segment selection: gpt-5-mini)
- **Video processing**: yt-dlp (download), ffmpeg (rendering)
- **Frontend**: React + Vite + Tailwind + shadcn/ui

## Structure

```text
artifacts-monorepo/
├── artifacts/
│   ├── api-server/         # Express API server (jobs, clips, download routes)
│   └── shorts-generator/   # React + Vite frontend (Studio Shorts UI)
├── lib/
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   ├── db/                 # Drizzle ORM schema + DB connection
│   └── integrations-openai-ai-server/  # OpenAI client via Replit AI Integrations
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── tsconfig.json
└── package.json
```

## Key Features

- Paste any YouTube URL → AI downloads, transcribes, selects best 15–60s segments
- Renders clips with: all-caps black Poppins Bold title on white bar at top, white all-caps captions centered at bottom
- Real-time job status polling (pending → downloading → transcribing → analyzing → rendering → completed)
- Download each generated clip as an MP4

## Database Schema

- `jobs` table: id, youtube_url, video_title, status, error_message, clip_count, created_at, updated_at
- `clips` table: id, job_id, title, start_seconds, end_seconds, duration_seconds, file_path, status, created_at

## API Routes

- `GET /api/jobs` — list all jobs
- `POST /api/jobs` — create a new job (starts processing async)
- `GET /api/jobs/:id` — get job + its clips
- `DELETE /api/jobs/:id` — delete a job
- `GET /api/clips/:clipId/download` — download a rendered clip MP4

## Environment Variables

- `DATABASE_URL` — PostgreSQL connection (auto-provisioned by Replit)
- `AI_INTEGRATIONS_OPENAI_BASE_URL` — OpenAI proxy base URL (auto-set)
- `AI_INTEGRATIONS_OPENAI_API_KEY` — OpenAI API key (auto-set)
- `SESSION_SECRET` — session secret

## Running

```bash
# API server
pnpm --filter @workspace/api-server run dev

# Frontend
pnpm --filter @workspace/shorts-generator run dev

# Codegen (after OpenAPI spec changes)
pnpm --filter @workspace/api-spec run codegen

# DB push
pnpm --filter @workspace/db run push
```

## Clips Storage

Generated clips are stored at `/home/runner/workspace/clips/clip_{id}.mp4` (relative to where the API server runs). The directory is auto-created on first run.

## Notes

- yt-dlp downloads the video (up to 720p) to a temp directory
- ffmpeg extracts audio at 16kHz mono for transcription
- OpenAI gpt-4o-mini-transcribe provides word-level timestamps
- gpt-5-mini selects the N best segments (configurable, default 3)
- ffmpeg renders final clips: white title bar + black text at top, white caption text at bottom
- Temp files are cleaned up after each job completes
