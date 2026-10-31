// Headless boot smoke test for CI.
//
// Serves a built folder over a throwaway local HTTP server, loads it in
// headless Chromium with Playwright and fails if the page logs a console
// error, throws an uncaught error, or a same-origin request fails.
//
// Usage: node scripts/ci-smoke.mjs [dir=dist] [--wait=ms] [--selector=css]
// Env:   PLAYWRIGHT_PREFIX    folder that holds node_modules/playwright, when
//                             Playwright is not a dependency of this repo.
//        SMOKE_CHROMIUM_PATH  optional Chromium executable to use instead of
//                             the one Playwright downloads.
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const root = path.resolve(args.find((a) => !a.startsWith("--")) ?? "dist");
const waitMs = Number(flag("wait", "5000"));
const selector = flag("selector", "canvas");

const requireFrom = createRequire(
  process.env.PLAYWRIGHT_PREFIX
    ? path.join(path.resolve(process.env.PLAYWRIGHT_PREFIX), "noop.js")
    : import.meta.url,
);
const { chromium } = requireFrom("playwright");

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".map": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    let file = path.join(root, decodeURIComponent(url.pathname));
    if (!file.startsWith(root)) throw new Error("outside root");
    if ((await stat(file).catch(() => null))?.isDirectory()) file = path.join(file, "index.html");
    const body = await readFile(file);
    res.writeHead(200, { "content-type": types[path.extname(file).toLowerCase()] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const problems = [];
const browser = await chromium.launch({
  headless: true,
  // Optional local override, e.g. an already-installed Chromium build.
  executablePath: process.env.SMOKE_CHROMIUM_PATH || undefined,
  // Software WebGL so canvas games boot on a GPU-less CI runner.
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"],
});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on("console", (msg) => {
    if (msg.type() === "error") problems.push(`console.error: ${msg.text()}`);
  });
  page.on("pageerror", (err) => problems.push(`page error: ${err.stack ?? err.message}`));
  page.on("requestfailed", (req) => {
    if (req.url().startsWith(origin)) problems.push(`request failed: ${req.url()} (${req.failure()?.errorText})`);
  });
  page.on("response", (res) => {
    if (res.url().startsWith(origin) && res.status() >= 400) problems.push(`HTTP ${res.status()}: ${res.url()}`);
  });

  const response = await page.goto(`${origin}/`, { waitUntil: "load", timeout: 60_000 });
  if (!response?.ok()) problems.push(`index returned HTTP ${response?.status()}`);
  await page.waitForTimeout(waitMs);

  if (selector && selector !== "none") {
    const count = await page.locator(selector).count();
    if (count === 0) problems.push(`expected at least one "${selector}" element after boot, found none`);
  }
  const title = await page.title();
  console.log(`Loaded ${origin}/ from ${root} (title: "${title}")`);
} finally {
  await browser.close();
  server.close();
}

if (problems.length) {
  console.error(`Smoke test FAILED with ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log("Smoke test passed: page booted with zero console errors.");
