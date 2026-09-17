import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright-core";
import { frameHtml } from "./html.mts";
import type { Mockup, SocialPost } from "./types.mts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SOCIAL = path.join(ROOT, "marketing/social");
const OUT = path.join(SOCIAL, "out");
const INBOX = path.join(SOCIAL, "inbox");
const MOCKUPS = path.join(SOCIAL, "mockups");

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp"]);

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0) return process.argv[i + 1];
  return undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function todayIST(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function dataUrl(buf: Buffer, ext: string): string {
  const mime =
    ext === ".jpg" || ext === ".jpeg"
      ? "image/jpeg"
      : ext === ".webp"
        ? "image/webp"
        : "image/png";
  return `data:${mime};base64,${buf.toString("base64")}`;
}

function escapePlain(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function loadPosts(): Promise<SocialPost[]> {
  const raw = await readFile(path.join(SOCIAL, "posts.json"), "utf8");
  return JSON.parse(raw) as SocialPost[];
}

async function loadMockup(id: string): Promise<Mockup> {
  const raw = await readFile(path.join(MOCKUPS, `${id}.json`), "utf8");
  return JSON.parse(raw) as Mockup;
}

async function inboxPhotos(postId: string): Promise<string[]> {
  const dir = path.join(INBOX, postId);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const ready = names.includes("READY");
  const files = names
    .filter((n) => IMAGE_EXT.has(path.extname(n).toLowerCase()))
    .sort()
    .map((n) => path.join(dir, n));
  if (files.length === 0) return [];
  if (!ready) {
    console.warn(
      `[${postId}] inbox has ${files.length} screenshot(s) but no READY file — using mockup. Drop an empty READY file after you redact names, amounts, and other people's mail.`,
    );
    return [];
  }
  return files;
}

async function launchBrowser() {
  try {
    return await chromium.launch({ channel: "chrome", headless: true });
  } catch {
    return await chromium.launch({ headless: true });
  }
}

type Layout = "feed" | "story" | "square";

const LAYOUT_SIZE: Record<Layout, { w: number; h: number }> = {
  feed: { w: 1080, h: 1350 },
  story: { w: 1080, h: 1920 },
  square: { w: 1080, h: 1080 },
};

async function shot(page: Page, html: string, layout: Layout, dest: string) {
  const { w, h } = LAYOUT_SIZE[layout];
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(html, { waitUntil: "networkidle" });
  await page.screenshot({ path: dest, type: "png" });
}

async function renderPost(page: Page, post: SocialPost) {
  const destDir = path.join(OUT, post.id);
  await mkdir(destDir, { recursive: true });
  const photos = await inboxPhotos(post.id);
  const mockup = await loadMockup(post.mockup);
  const written: string[] = [];

  if (photos.length > 0) {
    console.log(`[${post.id}] framing ${photos.length} redacted screenshot(s)`);
    for (const [i, file] of photos.entries()) {
      const buf = await readFile(file);
      const photoDataUrl = dataUrl(buf, path.extname(file).toLowerCase());
      const headline = escapePlain(post.hook);
      for (const layout of ["square", "feed", "story"] as Layout[]) {
        const html = frameHtml({
          layout,
          kicker: mockup.kicker,
          headline,
          photoDataUrl,
        });
        const dest = path.join(destDir, `${layout}-${String(i + 1).padStart(2, "0")}.png`);
        await shot(page, html, layout, dest);
        written.push(dest);
      }
    }
  } else {
    console.log(`[${post.id}] mockup ${post.mockup} (${mockup.beats.length} beat(s))`);
    for (const [i, beat] of mockup.beats.entries()) {
      for (const layout of ["square", "feed", "story"] as Layout[]) {
        const html = frameHtml({
          layout,
          kicker: mockup.kicker,
          headline: mockup.headline,
          ...(mockup.dayChip ? { dayChip: mockup.dayChip } : {}),
          messages: beat.messages,
        });
        const dest = path.join(destDir, `${layout}-${String(i + 1).padStart(2, "0")}.png`);
        await shot(page, html, layout, dest);
        written.push(dest);
      }
    }
  }

  const manifest = {
    id: post.id,
    date: post.date,
    source: photos.length > 0 ? "inbox" : "mockup",
    files: written.map((f) => path.relative(ROOT, f)),
    renderedAt: new Date().toISOString(),
  };
  await writeFile(path.join(destDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  return written;
}

async function main() {
  const posts = await loadPosts();
  const id = arg("id");
  const date = arg("date") ?? (hasFlag("today") ? todayIST() : undefined);
  const selected = id
    ? posts.filter((p) => p.id === id)
    : date
      ? posts.filter((p) => p.date === date)
      : posts;
  if (selected.length === 0) {
    throw new Error(`No posts matched id=${id ?? "-"} date=${date ?? "all"}`);
  }

  await mkdir(OUT, { recursive: true });
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    for (const post of selected) {
      await renderPost(page, post);
    }
  } finally {
    await browser.close();
  }
  console.log(`Rendered ${selected.length} post(s) → ${path.relative(ROOT, OUT)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
