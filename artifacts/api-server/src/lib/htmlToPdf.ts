import { execSync } from "child_process";
import puppeteer from "puppeteer-core";

let chromiumExecPath: string | null = null;

function getChromiumPath(): string {
  if (chromiumExecPath) return chromiumExecPath;
  try {
    const result = execSync("which chromium 2>/dev/null || ls /nix/store/*chromium*/bin/chromium 2>/dev/null | head -1", {
      encoding: "utf-8",
      shell: "/bin/bash",
    }).trim().split("\n")[0].trim();
    if (result) {
      chromiumExecPath = result;
      return result;
    }
  } catch {
    // fall through
  }
  throw new Error("Chromium not found. Install via: installSystemDependencies(['chromium'])");
}

/**
 * Convert an HTML string to a PDF Buffer.
 * Wraps the fragment in a minimal page with print-friendly styles.
 */
export async function htmlToPdf(htmlContent: string, title = ""): Promise<Buffer> {
  const executablePath = getChromiumPath();

  const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${title.replace(/</g, "&lt;")}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    html { font-size: 16px; }
    body {
      font-family: Georgia, "Times New Roman", serif;
      line-height: 1.7;
      color: #1a1a1a;
      max-width: 760px;
      margin: 0 auto;
      padding: 40px 48px;
    }
    h1, h2, h3 { font-family: Arial, Helvetica, sans-serif; margin-top: 1.4em; margin-bottom: 0.4em; }
    h1 { font-size: 2em; color: #111; }
    h2 { font-size: 1.4em; color: #222; }
    h3 { font-size: 1.15em; color: #333; }
    p  { margin: 0.75em 0; }
    ul, ol { padding-left: 1.5em; margin: 0.75em 0; }
    li { margin: 0.25em 0; }
    strong { font-weight: 700; }
    em { font-style: italic; }
    a { color: #2563eb; text-decoration: underline; }
    img { max-width: 100%; height: auto; }
    @page { margin: 20mm 18mm; }
    @media print {
      body { padding: 0; }
      h1, h2, h3 { page-break-after: avoid; }
      p, li { orphans: 3; widows: 3; }
    }
  </style>
</head>
<body>
${htmlContent}
</body>
</html>`;

  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-first-run",
      "--no-zygote",
      "--single-process",
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(fullHtml, { waitUntil: "load" });
    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "20mm", bottom: "20mm", left: "18mm", right: "18mm" },
    });
    return Buffer.from(pdfBuffer);
  } finally {
    await browser.close();
  }
}
