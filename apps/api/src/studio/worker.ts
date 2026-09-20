import { decryptToken } from "@amilo/google";
import {
  getStudioProduct,
  listDueStudioPosts,
  setStudioPostStatus,
  setStudioTargetStatus,
  type Db,
} from "@amilo/db";
import { publishToChannel, type ImageFile } from "./publish.js";

export function startStudioWorker(opts: {
  db: Db;
  encryptionKey: string;
  publicBaseUrl: string;
  intervalMs?: number;
}) {
  const interval = opts.intervalMs ?? 20_000;
  const tick = async () => {
    try {
      const due = await listDueStudioPosts(opts.db);
      for (const job of due) {
        await runJob(opts, job);
      }
    } catch (err) {
      console.error(
        JSON.stringify({
          event: "studio_worker_tick_error",
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  };
  void tick();
  return setInterval(() => void tick(), interval);
}

async function runJob(
  opts: { db: Db; encryptionKey: string; publicBaseUrl: string },
  job: Awaited<ReturnType<typeof listDueStudioPosts>>[number],
) {
  await setStudioPostStatus(opts.db, job.post.id, "posting", { error: null });
  const product = await getStudioProduct(opts.db, job.post.productId);
  const images: ImageFile[] = job.assets.map((a) => ({
    buf: Buffer.from(a.bytesB64, "base64"),
    mime: a.mime,
  }));
  const publicAssetUrls = job.assets.map(
    (a) => `${opts.publicBaseUrl}/studio/api/public/assets/${a.id}`,
  );
  let failed = 0;
  for (const target of job.targets) {
    if (target.status === "posted" || target.status === "skipped") continue;
    const channel = job.channels.find((c) => c.kind === target.channelKind && c.enabled);
    if (!channel?.credentialsEnc) {
      await setStudioTargetStatus(opts.db, target.id, "failed", {
        error: `No live ${target.channelKind} handle for ${product?.name ?? "product"}`,
      });
      failed += 1;
      continue;
    }
    try {
      const creds = JSON.parse(decryptToken(opts.encryptionKey, channel.credentialsEnc)) as Record<
        string,
        string
      >;
      if (channel.meta && typeof channel.meta.authorUrn === "string" && !creds.authorUrn) {
        creds.authorUrn = channel.meta.authorUrn;
      }
      const result = await publishToChannel(target.channelKind, {
        copy: target.copy,
        images,
        creds,
        publicAssetUrls,
      });
      await setStudioTargetStatus(opts.db, target.id, "posted", { remoteId: result.remoteId, error: null });
    } catch (err) {
      failed += 1;
      await setStudioTargetStatus(opts.db, target.id, "failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  if (failed === 0) {
    await setStudioPostStatus(opts.db, job.post.id, "posted", { postedAt: new Date(), error: null });
  } else {
    await setStudioPostStatus(opts.db, job.post.id, "failed", {
      error: `${failed} channel(s) failed`,
    });
  }
}
