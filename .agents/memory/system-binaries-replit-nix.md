---
name: System binaries must be in replit.nix
description: Dev shell often has binaries (ffmpeg, ffprobe, etc.) available that aren't declared in replit.nix, causing prod-only "spawn ENOENT" errors after deployment.
---

The Replit dev workspace shell exposes a broader set of pre-installed binaries than what actually ships in a deployed (autoscale/reserved-vm) container. A deployed container only gets what's declared as a Nix dependency in `replit.nix` (plus the configured language modules).

**Why:** A production bug reported "Processing Failed: spawn ffprobe ENOENT" even though the same code worked fine in the dev workflow. `which ffmpeg` / `which ffprobe` succeeded in dev because they were present at a Replit-runtime-path location, but `replit.nix` only listed `pkgs.yt-dlp` — ffmpeg was never declared as a dependency, so the deployment build didn't include it.

**How to apply:** Whenever code shells out to an external binary (ffmpeg, imagemagick, graphviz, pandoc, etc.), verify the binary is explicitly declared in `replit.nix` deps (via `installSystemDependencies` from the package-management skill), not just "happens to work" in the current dev shell. Don't rely on `which <binary>` succeeding in dev as proof it will work in production — cross-check `replit.nix`. This class of bug only surfaces after publishing, so it's easy to miss during normal dev-loop testing.
