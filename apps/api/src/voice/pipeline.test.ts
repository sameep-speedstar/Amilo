import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { spawnSync } from "node:child_process";
import { transcodeToWav, transcribeSarvam } from "./pipeline.js";

function hasFfmpeg(): boolean {
  const r = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" });
  return r.status === 0;
}

describe("voice pipeline", () => {
  it("transcodes a synthetic tone to a real-sized WAV", async (t) => {
    if (!hasFfmpeg()) {
      t.skip("ffmpeg not installed");
      return;
    }
    // Generate ~0.4s of silence as raw wav via ffmpeg itself, then re-encode.
    const gen = spawnSync(
      "ffmpeg",
      [
        "-y",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=0.4",
        "-f",
        "ogg",
        "pipe:1",
      ],
      { encoding: "buffer", maxBuffer: 2_000_000 },
    );
    assert.equal(gen.status, 0, gen.stderr?.toString("utf8")?.slice(-200));
    const ogg = Buffer.from(gen.stdout as Buffer);
    assert.ok(ogg.length > 100);
    const wav = await transcodeToWav(ogg);
    assert.ok(wav.length > 1000);
    // RIFF header + non-0xFFFFFFFF sizes (Sarvam rejects unknown-length WAVs).
    assert.equal(wav.subarray(0, 4).toString("ascii"), "RIFF");
    const dataSize = wav.readUInt32LE(4);
    assert.ok(dataSize > 0 && dataSize !== 0xffffffff);
  });

  it("parses Sarvam transcript field from mocked response", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ transcript: "  remind me at 5  " }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;
    try {
      const r = await transcribeSarvam(Buffer.from("RIFF"), {
        apiKey: "test-key",
        model: "saarika:v2.5",
      });
      assert.equal(r.text, "remind me at 5");
      assert.equal(r.confidence, null);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("surfaces Sarvam error body on failure", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: { message: "bad wav" } }), {
        status: 400,
      })) as typeof fetch;
    try {
      await assert.rejects(
        () =>
          transcribeSarvam(Buffer.from("RIFF"), {
            apiKey: "test-key",
          }),
        /Sarvam STT 400.*bad wav/,
      );
    } finally {
      globalThis.fetch = original;
    }
  });
});
