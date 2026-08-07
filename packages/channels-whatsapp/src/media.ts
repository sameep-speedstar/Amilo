import type { WabaConfig } from "./index.js";

export type WhatsAppMediaMeta = {
  url: string;
  mimeType: string;
  sha256?: string;
  fileSize?: number;
};

/** Resolve Graph media id → temporary download URL. */
export async function getWhatsAppMediaMeta(
  cfg: WabaConfig,
  mediaId: string,
): Promise<WhatsAppMediaMeta> {
  const version = cfg.apiVersion ?? "v21.0";
  const url = `https://graph.facebook.com/${version}/${mediaId}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${cfg.accessToken}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`WABA media meta failed ${res.status}: ${body}`);
  }
  const json = (await res.json()) as {
    url?: string;
    mime_type?: string;
    sha256?: string;
    file_size?: number;
  };
  if (!json.url) throw new Error("WABA media meta missing url");
  return {
    url: json.url,
    mimeType: json.mime_type ?? "audio/ogg",
    ...(json.sha256 ? { sha256: json.sha256 } : {}),
    ...(typeof json.file_size === "number" ? { fileSize: json.file_size } : {}),
  };
}

/** Download media bytes (WhatsApp CDN requires the same bearer token). */
export async function downloadWhatsAppMedia(
  cfg: WabaConfig,
  mediaId: string,
): Promise<{ bytes: Buffer; mimeType: string }> {
  const meta = await getWhatsAppMediaMeta(cfg, mediaId);
  const res = await fetch(meta.url, {
    headers: { Authorization: `Bearer ${cfg.accessToken}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`WABA media download failed ${res.status}: ${body}`);
  }
  const ab = await res.arrayBuffer();
  return { bytes: Buffer.from(ab), mimeType: meta.mimeType };
}
