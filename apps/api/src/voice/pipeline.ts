/**
 * Voice pipeline: raw WhatsApp audio → 16 kHz mono WAV → Sarvam STT.
 * Mirrors LifeOS lessons: seekable temp files (not pipes) so Sarvam
 * gets real WAV headers; no GCS required for Amilo v1.
 *
 * Sarvam's sync REST endpoint caps at 30s. Longer WhatsApp notes are
 * split into ≤28s chunks and transcripts concatenated (batch jobs are
 * too slow for a chat reply).
 */
import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Stay under Sarvam's 30s sync cap with a little headroom. */
export const SARVAM_SYNC_CHUNK_SEC = 28;
/** WhatsApp-sized ceiling; still chunked, not sent as one request. */
export const VOICE_MAX_SEC = 180;

export type TranscriptResult = {
  text: string;
  /** Sarvam does not expose confidence — always null. */
  confidence: number | null;
  /** Number of Sarvam requests used (1 for short notes). */
  chunks?: number;
};

export type SarvamConfig = {
  apiKey: string;
  /** Default matches LifeOS live: saarika:v2.5. Override with saaras:v3. */
  model?: string;
  languageCode?: string;
  mode?: string;
  endpoint?: string;
};

async function raiseWithBody(res: Response): Promise<void> {
  if (res.ok) return;
  const body = await res.text().catch(() => "");
  throw new Error(`Sarvam STT ${res.status}: ${body || res.statusText}`);
}

export function isDurationLimitError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /duration exceeds|maximum limit of 30/i.test(msg);
}

async function runTool(
  bin: "ffmpeg" | "ffprobe",
  args: string[],
  opts?: { captureStdout?: boolean },
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      stdio: ["ignore", opts?.captureStdout ? "pipe" : "ignore", "pipe"],
    });
    let err = "";
    let out = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      err += chunk.toString("utf8");
    });
    child.stdout?.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`${bin} exited ${code}: ${err.slice(-500)}`));
    });
  });
}

/**
 * ffmpeg any-container → 16 kHz mono WAV via temp files.
 * Pipes leave WAV size headers as 0xFFFFFFFF; Sarvam rejects those as >30s.
 */
export async function transcodeToWav(rawBytes: Buffer): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "amilo-voice-"));
  const inPath = join(dir, "input");
  const outPath = join(dir, "output.wav");
  try {
    await writeFile(inPath, rawBytes);
    await runTool("ffmpeg", [
      "-y",
      "-i",
      inPath,
      "-ar",
      "16000",
      "-ac",
      "1",
      "-f",
      "wav",
      outPath,
    ]);
    return await readFile(outPath);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function probeDurationSec(wavBytes: Buffer): Promise<number | null> {
  const dir = await mkdtemp(join(tmpdir(), "amilo-voice-probe-"));
  const inPath = join(dir, "input.wav");
  try {
    await writeFile(inPath, wavBytes);
    const out = await runTool(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", inPath],
      { captureStdout: true },
    );
    const n = Number(out.trim());
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function splitWav(
  wavBytes: Buffer,
  chunkSec = SARVAM_SYNC_CHUNK_SEC,
  maxSec = VOICE_MAX_SEC,
): Promise<Buffer[]> {
  const dir = await mkdtemp(join(tmpdir(), "amilo-voice-split-"));
  const inPath = join(dir, "input.wav");
  try {
    await writeFile(inPath, wavBytes);
    await runTool("ffmpeg", [
      "-y",
      "-i",
      inPath,
      "-f",
      "segment",
      "-segment_time",
      String(chunkSec),
      "-ar",
      "16000",
      "-ac",
      "1",
      "-c:a",
      "pcm_s16le",
      join(dir, "chunk-%03d.wav"),
    ]);
    const names = (await readdir(dir))
      .filter((n) => /^chunk-\d+\.wav$/.test(n))
      .sort();
    const out: Buffer[] = [];
    let elapsed = 0;
    for (const name of names) {
      if (elapsed >= maxSec) break;
      out.push(await readFile(join(dir, name)));
      elapsed += chunkSec;
    }
    return out.length ? out : [wavBytes];
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function transcribeChunks(
  chunks: Buffer[],
  cfg: SarvamConfig,
): Promise<TranscriptResult> {
  const parts: string[] = [];
  for (const chunk of chunks) {
    const r = await transcribeSarvam(chunk, cfg);
    if (r.text) parts.push(r.text);
  }
  return {
    text: parts.join(" ").replace(/\s+/g, " ").trim(),
    confidence: null,
    chunks: chunks.length,
  };
}

export async function transcribeSarvam(
  wavBytes: Buffer,
  cfg: SarvamConfig,
): Promise<TranscriptResult> {
  if (!cfg.apiKey) throw new Error("SARVAM_API_KEY is not configured");
  const endpoint = cfg.endpoint ?? "https://api.sarvam.ai/speech-to-text";
  const model = cfg.model ?? "saarika:v2.5";
  const languageCode = cfg.languageCode ?? "unknown";

  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(wavBytes)], { type: "audio/wav" }),
    "audio.wav",
  );
  form.append("model", model);
  form.append("language_code", languageCode);
  if (model.startsWith("saaras:") && cfg.mode) {
    form.append("mode", cfg.mode);
  }

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "api-subscription-key": cfg.apiKey },
    body: form,
  });
  await raiseWithBody(res);
  const payload = (await res.json()) as { transcript?: string; text?: string };
  const text = (payload.transcript ?? payload.text ?? "").trim();
  return { text, confidence: null, chunks: 1 };
}

export async function processVoiceNote(
  rawBytes: Buffer,
  cfg: SarvamConfig,
): Promise<TranscriptResult> {
  const wav = await transcodeToWav(rawBytes);
  const duration = await probeDurationSec(wav);
  const overLimit = duration != null && duration > SARVAM_SYNC_CHUNK_SEC;

  if (!overLimit) {
    try {
      return await transcribeSarvam(wav, cfg);
    } catch (err) {
      if (!isDurationLimitError(err)) throw err;
    }
  }

  const chunks = await splitWav(wav);
  return transcribeChunks(chunks, cfg);
}
