import { TwitterApi } from "twitter-api-v2";

export type ImageFile = { buf: Buffer; mime: string };

export type PublishInput = {
  copy: string;
  images: ImageFile[];
  creds: Record<string, string>;
  publicAssetUrls: string[];
};

export type PublishResult = { remoteId: string };

function splitThread(text: string): string[] {
  return text
    .split(/\n\n(?=\d+\/)/)
    .map((p) => p.trim())
    .filter(Boolean);
}

export async function publishX(input: PublishInput): Promise<PublishResult> {
  const { apiKey, apiSecret, accessToken, accessSecret } = input.creds;
  if (!apiKey || !apiSecret || !accessToken || !accessSecret) {
    throw new Error("X needs apiKey, apiSecret, accessToken, accessSecret");
  }
  const client = new TwitterApi({ appKey: apiKey, appSecret: apiSecret, accessToken, accessSecret });
  const tweets = splitThread(input.copy);
  if (tweets.length === 0) throw new Error("Empty X copy");
  const mediaIds =
    input.images.length > 0
      ? await Promise.all(
          input.images.slice(0, 4).map((img) =>
            client.v1.uploadMedia(img.buf, { mimeType: img.mime }),
          ),
        )
      : [];
  let lastId: string | undefined;
  let firstId = "";
  for (const [i, chunk] of tweets.entries()) {
    const payload: Record<string, unknown> = { text: chunk };
    if (i === 0 && mediaIds.length > 0) {
      payload.media = { media_ids: mediaIds };
    }
    if (lastId) payload.reply = { in_reply_to_tweet_id: lastId };
    const res = await client.v2.tweet(payload as never);
    lastId = res.data.id;
    if (i === 0) firstId = lastId;
  }
  return { remoteId: firstId };
}

const GRAPH = "https://graph.facebook.com/v21.0";

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
  if (!res.ok || !json.id) throw new Error(`IG create: ${JSON.stringify(json)}`);
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
    if (json.status_code === "ERROR") throw new Error(`IG container ${creationId} errored`);
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`IG container ${creationId} timed out`);
}

async function igPublish(token: string, igUserId: string, creationId: string): Promise<string> {
  await igWait(token, creationId);
  const url = new URL(`${GRAPH}/${igUserId}/media_publish`);
  url.searchParams.set("creation_id", creationId);
  url.searchParams.set("access_token", token);
  const res = await fetch(url, { method: "POST" });
  const json = (await res.json()) as { id?: string };
  if (!res.ok || !json.id) throw new Error(`IG publish: ${JSON.stringify(json)}`);
  return json.id;
}

export async function publishInstagram(input: PublishInput): Promise<PublishResult> {
  const token = input.creds.accessToken;
  const igUserId = input.creds.userId;
  if (!token || !igUserId) throw new Error("Instagram needs userId and accessToken");
  if (input.publicAssetUrls.length === 0) {
    throw new Error("Instagram needs at least one public image URL");
  }
  const urls = input.publicAssetUrls.slice(0, 10);
  const caption = input.copy;
  let creationId: string;
  if (urls.length === 1) {
    creationId = await igCreate(token, igUserId, { image_url: urls[0]!, caption });
  } else {
    const children: string[] = [];
    for (const url of urls) {
      children.push(await igCreate(token, igUserId, { image_url: url, is_carousel_item: "true" }));
    }
    creationId = await igCreate(token, igUserId, {
      media_type: "CAROUSEL",
      children: children.join(","),
      caption,
    });
  }
  const id = await igPublish(token, igUserId, creationId);
  return { remoteId: id };
}

async function linkedInUploadImage(
  token: string,
  owner: string,
  image: ImageFile,
): Promise<string> {
  const register = await fetch(
    "https://api.linkedin.com/v2/assets?action=registerUpload",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Restli-Protocol-Version": "2.0.0",
      },
      body: JSON.stringify({
        registerUploadRequest: {
          recipes: ["urn:li:digitalmediaRecipe:feedshare-image"],
          owner,
          serviceRelationships: [
            {
              relationshipType: "OWNER",
              identifier: "urn:li:userGeneratedContent",
            },
          ],
        },
      }),
    },
  );
  const regJson = (await register.json()) as {
    value?: {
      asset?: string;
      uploadMechanism?: {
        "com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"?: { uploadUrl?: string };
      };
    };
  };
  const uploadUrl =
    regJson.value?.uploadMechanism?.["com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"]
      ?.uploadUrl;
  const asset = regJson.value?.asset;
  if (!register.ok || !uploadUrl || !asset) {
    throw new Error(`LinkedIn register upload: ${JSON.stringify(regJson)}`);
  }
  const buf = image.buf;
  const put = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": image.mime,
    },
    body: buf,
  });
  if (!put.ok) throw new Error(`LinkedIn image PUT ${put.status}`);
  return asset;
}

export async function publishLinkedIn(input: PublishInput): Promise<PublishResult> {
  const token = input.creds.accessToken;
  const author = input.creds.authorUrn;
  if (!token || !author) throw new Error("LinkedIn needs accessToken and authorUrn");
  const mediaUrns: string[] = [];
  for (const img of input.images.slice(0, 9)) {
    mediaUrns.push(await linkedInUploadImage(token, author, img));
  }
  const shareContent: Record<string, unknown> = {
    shareCommentary: { text: input.copy },
    shareMediaCategory: mediaUrns.length ? "IMAGE" : "NONE",
  };
  if (mediaUrns.length) {
    shareContent.media = mediaUrns.map((urn) => ({
      status: "READY",
      media: urn,
    }));
  }
  const res = await fetch("https://api.linkedin.com/v2/ugcPosts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Restli-Protocol-Version": "2.0.0",
    },
    body: JSON.stringify({
      author,
      lifecycleState: "PUBLISHED",
      specificContent: { "com.linkedin.ugc.ShareContent": shareContent },
      visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
    }),
  });
  const json = (await res.json()) as { id?: string };
  if (!res.ok || !json.id) throw new Error(`LinkedIn post: ${JSON.stringify(json)}`);
  return { remoteId: json.id };
}

export async function resolveLinkedInAuthor(token: string): Promise<string> {
  const res = await fetch("https://api.linkedin.com/v2/userinfo", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.ok) {
    const json = (await res.json()) as { sub?: string };
    if (json.sub) return `urn:li:person:${json.sub}`;
  }
  const me = await fetch("https://api.linkedin.com/v2/me", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const meJson = (await me.json()) as { id?: string };
  if (meJson.id) return `urn:li:person:${meJson.id}`;
  throw new Error("Could not resolve LinkedIn author URN — paste urn:li:person:… or urn:li:organization:…");
}

export async function publishToChannel(
  kind: string,
  input: PublishInput,
): Promise<PublishResult> {
  if (kind === "x") return publishX(input);
  if (kind === "instagram") return publishInstagram(input);
  if (kind === "linkedin") return publishLinkedIn(input);
  throw new Error(`No publisher for ${kind}`);
}
