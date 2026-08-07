/**
 * Voice pipeline: raw WhatsApp audio → 16 kHz mono WAV → Sarvam STT.
 * Mirrors LifeOS lessons: seekable temp files (not pipes) so Sarvam
 * gets real WAV headers; no GCS required for Amilo v1.
 */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type TranscriptResult = {
  text: string;
  /** Sarvam does not expose confidence — always null. */
  confidence: number | null;
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
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        "ffmpeg",
        ["-y", "-i", inPath, "-ar", "16000", "-ac", "1", "-f", "wav", outPath],
        { stdio: ["ignore", "ignore", "pipe"] },
      );
      let err = "";
      child.stderr?.on("data", (chunk: Buffer) => {
        err += chunk.toString("utf8");
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg exited ${code}: ${err.slice(-500)}`));
      });
    });
    return await readFile(outPath);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
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
  return { text, confidence: null };
}

export async function processVoiceNote(
  rawBytes: Buffer,
  cfg: SarvamConfig,
): Promise<TranscriptResult> {
  const wav = await transcodeToWav(rawBytes);
  return transcribeSarvam(wav, cfg);
}
