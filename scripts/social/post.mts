import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TwitterApi } from "twitter-api-v2";
import type { Ledger, Platform, SocialPost } from "./types.mts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SOCIAL = path.join(ROOT, "marketing/social");
const OUT = path.join(SOCIAL, "out");
const LEDGER_PATH = path.join(SOCIAL, "posted.json");
const GRAPH = "https://graph.facebook.com/v21.0";

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

function loadDotenv() {
  const p = path.join(ROOT, ".env");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq);
    let val = trimmed.slice(eq + 1);
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

async function loadPosts(): Promise<SocialPost[]> {
  return JSON.parse(await readFile(path.join(SOCIAL, "posts.json"), "utf8")) as SocialPost[];
}

async function loadLedger(): Promise<Ledger> {
  try {
    return JSON.parse(await readFile(LEDGER_PATH, "utf8")) as Ledger;
  } catch {
    return {};
  }
}

async function saveLedger(ledger: Ledger) {
  await writeFile(LEDGER_PATH, JSON.stringify(ledger, null, 2) + "\n");
}

function splitThread(text: string): string[] {
  const parts = text.split(/\n\n(?=\d+\/)/);
  return parts.map((p) => p.trim()).filter(Boolean);
}

async function mediaFiles(postId: string, kind: "square" | "feed" | "story"): Promise<string[]> {
  const dir = path.join(OUT, postId);
  const names = (await readdir(dir))
    .filter((n) => n.startsWith(`${kind}-`) && n.endsWith(".png"))
    .sort();
  return names.map((n) => path.join(dir, n));
}

function xClient(): TwitterApi {
  const appKey = process.env.X_API_KEY;
  const appSecret = process.env.X_API_SECRET;
  const accessToken = process.env.X_ACCESS_TOKEN;
  const accessSecret = process.env.X_ACCESS_SECRET;
  if (!appKey || !appSecret || !accessToken || !accessSecret) {
    throw new Error("Missing X_API_KEY / X_API_SECRET / X_ACCESS_TOKEN / X_ACCESS_SECRET");
  }
  return new TwitterApi({ appKey, appSecret, accessToken, accessSecret });
}

async function tweet(
  live: boolean,
  text: string,
  images: string[],
): Promise<string> {
  const tweets = splitThread(text);
  const attached = images.slice(0, 4);
  if (!live) {
    console.log(`  [dry-run] X @Amilo_io (${tweets.length} tweet(s), ${attached.length} image(s))`);
    for (const [i, t] of tweets.entries()) {
      console.log(`  --- tweet ${i + 1} ---`);
      console.log(t);
    }
    for (const img of attached) console.log(`  media ${path.relative(ROOT, img)}`);
    return "dry-run";
  }
  const client = xClient();
  const mediaIds =
    attached.length > 0
      ? await Promise.all(attached.map((f) => client.v1.uploadMedia(f)))
      : [];
  let lastId: string | undefined;
  let firstId = "";
  for (const [i, chunk] of tweets.entries()) {
    const payload: {
      text: string;
      media?: { media_ids: string[] };
      reply?: { in_reply_to_tweet_id: string };
    } = { text: chunk };
    if (i === 0 && mediaIds.length > 0) {
      payload.media = { media_ids: mediaIds as [string, ...string[]] };
    }
    if (lastId) payload.reply = { in_reply_to_tweet_id: lastId };
    const res = await client.v2.tweet(payload);
    lastId = res.data.id;
    if (i === 0) firstId = lastId;
  }
  console.log(`  posted X https://x.com/Amilo_io/status/${firstId}`);
  return firstId;
}

async function uploadPublic(local: string, destName: string): Promise<string> {
  const prefix = process.env.SOCIAL_PUBLIC_BASE;
  const account = process.env.AZURE_STORAGE_ACCOUNT ?? "amilostaticweb";
  const r = spawnSync(
    "az",
    [
      "storage",
      "blob",
      "upload",
      "--account-name",
      account,
      "-c",
      "$web",
      "-f",
      local,
      "-n",
      `social-tmp/${destName}`,
      "--auth-mode",
      "login",
      "--overwrite",
      "--content-type",
      "image/png",
    ],
    { encoding: "utf8" },
  );
  if (r.status !== 0) {
    throw new Error(
      `Azure upload failed (needed so Instagram can fetch the image).\n${r.stderr || r.stdout}`,
    );
  }
  const base = (prefix ?? "https://amilo.io").replace(/\/$/, "");
  return `${base}/social-tmp/${destName}`;
}

async function igCreate(
  token: string,
  igUserId: string,
  body: Record<string, string>,
): Promise<string> {
  const url = new URL(`${GRAPH}/${igUserId}/media`);
  url.searchParams.set("access_token", token);
  for (const [k, v] of Object.entries(body)) url.searchParams.set(k, v);
  const res = await fetch(url, { method: "POST" });
  const json = (await res.json()) as { id?: string; error?: { message: string } };
  if (!res.ok || !json.id) {
    throw new Error(`IG media create failed: ${JSON.stringify(json)}`);
  }
  return json.id;
}

async function igWait(token: string, creationId: string) {
  for (let i = 0; i < 20; i++) {
    const url = new URL(`${GRAPH}/${creationId}`);
    url.searchParams.set("fields", "status_code");
    url.searchParams.set("access_token", token);
    const res = await fetch(url);
    const json = (await res.json()) as { status_code?: string };
    if (json.status_code === "FINISHED") return;
    if (json.status_code === "ERROR") {
      throw new Error(`IG container ${creationId} errored`);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`IG container ${creationId} did not finish`);
}

async function igPublish(token: string, igUserId: string, creationId: string): Promise<string> {
  await igWait(token, creationId);
  const url = new URL(`${GRAPH}/${igUserId}/media_publish`);
  url.searchParams.set("creation_id", creationId);
  url.searchParams.set("access_token", token);
  const res = await fetch(url, { method: "POST" });
  const json = (await res.json()) as { id?: string; error?: { message: string } };
  if (!res.ok || !json.id) {
    throw new Error(`IG publish failed: ${JSON.stringify(json)}`);
  }
  return json.id;
}

async function instagramFeed(
  live: boolean,
  caption: string,
  images: string[],
  postId: string,
): Promise<string> {
  const attached = images.slice(0, 10);
  if (!live) {
    console.log(`  [dry-run] IG @amilo.io feed (${attached.length} image(s))`);
    console.log(caption);
    for (const img of attached) console.log(`  media ${path.relative(ROOT, img)}`);
    return "dry-run";
  }
  const token = process.env.IG_ACCESS_TOKEN;
  const igUserId = process.env.IG_USER_ID;
  if (!token || !igUserId) {
    throw new Error("Missing IG_ACCESS_TOKEN / IG_USER_ID");
  }
  if (attached.length === 0) throw new Error(`No feed images for ${postId}`);

  const urls: string[] = [];
  for (const [i, file] of attached.entries()) {
    const dest = `${postId}-feed-${String(i + 1).padStart(2, "0")}.png`;
    urls.push(await uploadPublic(file, dest));
  }

  let creationId: string;
  if (urls.length === 1) {
    const url = urls[0];
    if (!url) throw new Error("missing image url");
    creationId = await igCreate(token, igUserId, {
      image_url: url,
      caption,
    });
  } else {
    const children: string[] = [];
    for (const url of urls) {
      children.push(
        await igCreate(token, igUserId, {
          image_url: url,
          is_carousel_item: "true",
        }),
      );
    }
    creationId = await igCreate(token, igUserId, {
      media_type: "CAROUSEL",
      children: children.join(","),
      caption,
    });
  }
  const mediaId = await igPublish(token, igUserId, creationId);
  console.log(`  posted IG feed ${mediaId}`);
  return mediaId;
}

async function instagramStory(
  live: boolean,
  images: string[],
  postId: string,
): Promise<string> {
  const file = images.at(-1);
  if (!file) throw new Error(`No story image for ${postId}`);
  if (!live) {
    console.log(`  [dry-run] IG @amilo.io story`);
    console.log(`  media ${path.relative(ROOT, file)}`);
    return "dry-run";
  }
  const token = process.env.IG_ACCESS_TOKEN;
  const igUserId = process.env.IG_USER_ID;
  if (!token || !igUserId) {
    throw new Error("Missing IG_ACCESS_TOKEN / IG_USER_ID");
  }
  const url = await uploadPublic(file, `${postId}-story.png`);
  const creationId = await igCreate(token, igUserId, {
    image_url: url,
    media_type: "STORIES",
  });
  const mediaId = await igPublish(token, igUserId, creationId);
  console.log(`  posted IG story ${mediaId}`);
  return mediaId;
}

function wantsPlatform(selected: Platform[] | undefined, p: Platform): boolean {
  return !selected || selected.includes(p);
}

async function main() {
  loadDotenv();
  const live = hasFlag("live");
  const stories = hasFlag("stories");
  const platformsArg = arg("platforms");
  const selectedPlatforms = platformsArg
    ? (platformsArg.split(",") as Platform[])
    : undefined;
  const id = arg("id");
  const date = arg("date") ?? (hasFlag("today") ? todayIST() : undefined);
  const force = hasFlag("force");

  const posts = await loadPosts();
  const picked = id
    ? posts.filter((p) => p.id === id)
    : date
      ? posts.filter((p) => p.date === date)
      : posts.filter((p) => p.date === todayIST());

  if (picked.length === 0) {
    throw new Error(
      `No posts due (id=${id ?? "-"} date=${date ?? todayIST()}). Pass --id or --date.`,
    );
  }

  const ledger = await loadLedger();
  if (!live) {
    console.log("Dry-run. Pass --live to publish to @Amilo_io and @amilo.io.\n");
  }

  for (const post of picked) {
    console.log(`\n${post.id}  ${post.date}  ${post.platforms.join("+")}`);
    const outDir = path.join(OUT, post.id);
    if (!existsSync(outDir)) {
      console.log("  rendering first…");
      const r = spawnSync(
        process.execPath,
        [
          "--experimental-strip-types",
          "--no-warnings",
          path.join(ROOT, "scripts/social/render.mts"),
          "--id",
          post.id,
        ],
        { stdio: "inherit" },
      );
      if (r.status !== 0) throw new Error(`render failed for ${post.id}`);
    }

    const entry = ledger[post.id] ?? { at: new Date().toISOString() };

    if (post.platforms.includes("x") && wantsPlatform(selectedPlatforms, "x")) {
      if (entry.x && !force) {
        console.log(`  skip X (already ${entry.x})`);
      } else if (!post.copy.x) {
        console.log("  skip X (no copy)");
      } else {
        const images = await mediaFiles(post.id, "square");
        entry.x = await tweet(live, post.copy.x, images);
      }
    }

    if (post.platforms.includes("instagram") && wantsPlatform(selectedPlatforms, "instagram")) {
      if (entry.instagram && !force) {
        console.log(`  skip IG feed (already ${entry.instagram})`);
      } else if (!post.copy.instagram) {
        console.log("  skip IG (no copy)");
      } else {
        const images = await mediaFiles(post.id, "feed");
        entry.instagram = await instagramFeed(live, post.copy.instagram, images, post.id);
      }
      if (stories) {
        if (entry.story && !force) {
          console.log(`  skip IG story (already ${entry.story})`);
        } else {
          const images = await mediaFiles(post.id, "story");
          entry.story = await instagramStory(live, images, post.id);
        }
      }
    }

    entry.at = new Date().toISOString();
    if (live) {
      ledger[post.id] = entry;
      await saveLedger(ledger);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
