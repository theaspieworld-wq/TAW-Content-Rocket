{pkgs}: {
  deps = [
    pkgs.nodejs_24
    pkgs.chromium
    pkgs.ffmpeg-full
    pkgs.yt-dlp
  ];
}
