// Renders showreel.html to an MP4: audio through OfflineAudioContext, video frame by frame.
//
//   node render.mjs out.mp4                 full render (1920x1080, 60 fps)
//   node render.mjs out.mp4 --fps 30        lighter render
//   node render.mjs stills/ --stills 9.6,14,23   PNG stills only
//   node render.mjs out.wav --audio-only    audio only
//
// Needs Playwright (with a Chromium) and ffmpeg with libx264 on PATH.
// Set CHROMIUM_PATH to use a specific Chromium binary.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

let chromium;
try { ({ chromium } = await import("playwright")); }
catch { ({ chromium } = await import("/opt/node22/lib/node_modules/playwright/index.mjs")); }

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const out = path.resolve(args[0] || "litwave-showreel.mp4");
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const fps = Number(flag("--fps") || 60);
const stills = flag("--stills");
const audioOnly = args.includes("--audio-only");

function wavHeader(dataBytes, sampleRate, channels = 2) {
  const b = Buffer.alloc(44);
  b.write("RIFF", 0); b.writeUInt32LE(36 + dataBytes, 4); b.write("WAVE", 8); b.write("fmt ", 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(channels, 22); b.writeUInt32LE(sampleRate, 24);
  b.writeUInt32LE(sampleRate * channels * 2, 28); b.writeUInt16LE(channels * 2, 32); b.writeUInt16LE(16, 34);
  b.write("data", 36); b.writeUInt32LE(dataBytes, 40);
  return b;
}

const launch = { args: ["--autoplay-policy=no-user-gesture-required"] };
if (process.env.CHROMIUM_PATH) launch.executablePath = process.env.CHROMIUM_PATH;
const browser = await chromium.launch(launch);
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on("pageerror", (e) => console.error("page error:", e.message));
await page.goto(pathToFileURL(path.join(here, "showreel.html")).href);
await page.evaluate(() => window.SHOWREEL.fontsReady);

if (stills) {
  fs.mkdirSync(out, { recursive: true });
  for (const t of stills.split(",").map(Number)) {
    const url = await page.evaluate((tt) => window.SHOWREEL.frame(tt, .92), t);
    fs.writeFileSync(path.join(out, `still-${t.toFixed(2)}.jpg`), Buffer.from(url.split(",")[1], "base64"));
  }
  console.log(`wrote ${stills.split(",").length} stills to ${out}`);
  await browser.close();
  process.exit(0);
}

// ---- Audio ----
console.log("rendering audio…");
const info = await page.evaluate((solo) => window.SHOWREEL.renderAudio(48000, solo), flag("--solo"));
let b64 = "";
for (let i = 0; i < info.length; i += 4_000_000) b64 += await page.evaluate(([a, s]) => window.SHOWREEL.pcmChunk(a, s), [i, 4_000_000]);
const pcm = Buffer.from(b64, "base64");
const wavPath = audioOnly ? out : out.replace(/\.[^.]+$/, "") + ".wav";
fs.writeFileSync(wavPath, Buffer.concat([wavHeader(pcm.length, info.sampleRate), pcm]));
console.log(`audio: ${(info.frames / info.sampleRate).toFixed(1)} s, peak ${info.peak.toFixed(3)} -> ${wavPath}`);
if (audioOnly) { await browser.close(); process.exit(0); }

// ---- Video ----
const { DURATION } = await page.evaluate(() => ({ DURATION: window.SHOWREEL.DURATION }));
const frames = Math.round(DURATION * fps);
const ff = spawn("ffmpeg", [
  "-y", "-loglevel", "error",
  "-f", "image2pipe", "-framerate", String(fps), "-c:v", "mjpeg", "-i", "-",
  "-i", wavPath,
  "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", "-profile:v", "high",
  "-c:a", "aac", "-b:a", "256k", "-movflags", "+faststart", "-shortest", out
], { stdio: ["pipe", "inherit", "inherit"] });
const done = new Promise((res, rej) => ff.on("close", (c) => c === 0 ? res() : rej(new Error("ffmpeg exited " + c))));

const started = Date.now();
for (let i = 0; i < frames; i++) {
  const url = await page.evaluate((t) => window.SHOWREEL.frame(t, .94), i / fps);
  if (!ff.stdin.write(Buffer.from(url.slice(url.indexOf(",") + 1), "base64"))) await new Promise((r) => ff.stdin.once("drain", r));
  if (i % (fps * 5) === 0) console.log(`frame ${i}/${frames} (${((Date.now() - started) / 1000).toFixed(0)} s)`);
}
ff.stdin.end();
await done;
await browser.close();
fs.unlinkSync(wavPath);
console.log(`done -> ${out}`);
