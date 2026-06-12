# Workspace

## Overview

TAW Media Content Rocket. pnpm workspace monorepo using TypeScript. Paste a YouTube URL and the app automatically downloads, transcribes, selects the best moments with AI, renders short-form vertical clips, generates a full content pack (blog, newsletter, social posts, carousel slides, podcast audio), and supports multi-brand workflows.

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
- **AI**: OpenAI via Replit AI Integrations (transcription: gpt-4o-mini-transcribe, segment selection + content: gpt-5-mini)
- **Video processing**: yt-dlp (download), ffmpeg (rendering, carousel, podcast)
- **Frontend**: React + Vite + Tailwind + shadcn/ui

## Structure

```text
artifacts-monorepo/
├── artifacts/
│   ├── api-server/         # Express API server (jobs, clips, brands, download routes)
│   └── shorts-generator/   # React + Vite frontend (TAW Media Content Rocket UI)
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

- Paste any YouTube URL → AI downloads, transcribes, selects best segments with configurable clip length (15/30/45/60/90s)
- Clips rendered with title overlay + burned-in captions; optional outro overlay
- Shorts toggle (include/exclude vertical clips), configurable clip count (0–10)
- Multi-brand support: logos, voice style, default CTA, intro/outro audio files, Google Font family, primary/secondary brand colors
- Podcast audio extraction at 192kbps with brand intro/outro concat
- 4-slide carousel infographic PNG generation: AI-generated photographic background per slide via gpt-image-1, brand colors (primary accent bar + secondary divider), brand Google Font downloaded + cached, brand name in footer
- Full content pack: blog post HTML, newsletter email, social posts, quotes + Instagram captions, carousel caption
- Export All ZIP download: shorts + facebook 1:1 + podcast + carousel slides + content folder
- CSV export of quotes + captions
- Real-time job status polling (pending → downloading → transcribing → analyzing → rendering → completed)

## Database Schema

- `brands` table: id, name, logo_path, voice_style, default_cta, intro_audio_path, outro_audio_path, font_family, primary_color, secondary_color, created_at
- `jobs` table: id, youtube_url, video_title, status, error_message, clip_count, clip_duration_seconds, content_cta, outro_id, brand_id, transcript, generated_content, created_at, updated_at
- `clips` table: id, job_id, title, start_seconds, end_seconds, duration_seconds, file_path, status, created_at
- `outros` table: id, name, file_path, is_default, position, cta_text, cta_start_seconds, created_at

## API Routes

- `GET /api/jobs` — list all jobs
- `POST /api/jobs` — create a new job (starts processing async)
- `GET /api/jobs/:id` — get job + its clips
- `DELETE /api/jobs/:id` — delete a job
- `GET /api/jobs/:id/content` — get generated content (blog, social, carousel, etc.)
- `POST /api/jobs/:id/regenerate-content` — regenerate content with AI
- `GET /api/jobs/:id/download-podcast` — download podcast MP3
- `GET /api/jobs/:id/download-all` — download ZIP of all outputs
- `GET /api/clips/:clipId/download` — download a rendered clip MP4
- `GET /api/brands` — list brands
- `POST /api/brands` — create brand
- `PUT /api/brands/:id` — update brand
- `DELETE /api/brands/:id` — delete brand
- `POST /api/brands/:id/logo` — upload brand logo
- `POST /api/brands/:id/intro-audio` — upload brand intro audio
- `POST /api/brands/:id/outro-audio` — upload brand outro audio
- `GET /api/brands/:id/logo` — serve brand logo
- `GET /api/outros` — list outros
- `POST /api/outros/upload` — upload outro video
- `PUT /api/outros/:id` — update outro
- `DELETE /api/outros/:id` — delete outro
- `POST /api/outros/:id/set-default` — set default outro
- `GET /api/images/:filename` — serve generated carousel PNG images

## File Storage

- `clips/` — rendered MP4s, podcast MP3s, carousel PNGs, ZIP exports
- `brands/` — uploaded brand logos and intro/outro audio files
- `outros/` — uploaded outro video files

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
pnpm --filter @workspace/db run push-force

# Typecheck libs (must run before leaf typechecks)
pnpm run typecheck:libs

# Full typecheck
pnpm run typecheck
```

## Notes

- yt-dlp downloads the video (up to 720p) to a temp directory
- ffmpeg extracts audio at 16kHz mono for transcription, 192kbps MP3 for podcast
- OpenAI gpt-4o-mini-transcribe provides word-level timestamps
- gpt-5-mini selects clip segments and generates all content (respects brand voice + CTA)
- ffmpeg renders final clips: white title bar + black text at top, white caption text at bottom
- Carousel slides generated via ffmpeg drawtext (4 slides, 1080x1080 PNG)
- Podcast: raw audio extract + optional brand intro/outro concat via ffmpeg concat demuxer
- ZIP uses `archiver` package; folder structure: `[VideoTitle]/shorts/`, `facebook_1x1.mp4`, `podcast.mp3`, `carousel/`, `content/`
- Brand file uploads stored in `artifacts/api-server/brands/`
- Temp files are cleaned up after each job completes
- `hasPodcast` and `hasFacebookVideo` are computed dynamically by checking if files exist on disk
- Frontend uses `zod/v4` for form schemas; zodResolver uses `as any` cast due to structural type incompatibility between zod/v4 and @hookform/resolvers peer types (runtime validation works correctly)

## Subscription Gate

- App is gated behind a Stripe subscription. Signed-in users without an active subscription see a "Subscription required" screen → `/pricing`.
- Admins are subscription-exempt: `stripeService.isAdmin()` checks `ADMIN_USER_IDS` / `ADMIN_EMAILS` env vars. `teamtawsupport@gmail.com` is an admin.
- Frontend: `useSubscriptionStatus()` in `App.tsx` fetches `/api/stripe/subscription` (returns `{ active, isAdmin }`); cache keys in sessionStorage are scoped per `user.id`; fails closed (non-admin without confirmed active → denied).
- Server-side enforcement: `requireSubscription` middleware (`middlewares/requireSubscription.ts`) gates `jobs`/`outros`/`brands` routes (after `requireAuth`, `me`, `admin`). `stripe`, `me`, and `admin` routes stay accessible. Fails closed on any error.

## YouTube Bot-Block Mitigation (admin-configurable, no redeploy)

- Deployed apps run on datacenter IPs → YouTube "Sign in to confirm you're not a bot". Fix via Admin tab (visible only to admins).
- Two levers stored in the `app_config` DB table, hot-loaded into `process.env` at startup and on admin save:
  - `youtube_proxy` (base64) → decoded into `YTDLP_PROXY`; `processor.ts getProxyArgs()` adds `--proxy`. Most reliable fix; use a residential/rotating proxy. Masked in admin GET responses.
  - `youtube_cookies` (base64 Netscape txt) → `YOUTUBE_COOKIES`; `writeCookiesFile()` adds `--cookies`. Fragile stopgap; expires.
- Admin routes: `GET/POST/DELETE /api/admin/youtube-proxy` and `/api/admin/youtube-cookies` (gated by `requireAdmin`).
- Do NOT force a yt-dlp `player_client` — breaks on yt-dlp 2026+. Let the default client run and layer proxy/cookies on top.
