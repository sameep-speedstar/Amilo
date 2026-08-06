import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/** AES-256-GCM token encryption. TOKEN_ENCRYPTION_KEY = base64 of 32 raw bytes (or any passphrase hashed). */

function keyBytes(secret: string): Buffer {
  const trimmed = secret.trim();
  try {
    const buf = Buffer.from(trimmed, "base64");
    if (buf.length === 32) return buf;
  } catch {
    /* fall through */
  }
  return createHash("sha256").update(trimmed).digest();
}

export function encryptToken(secret: string, plaintext: string): string {
  const key = keyBytes(secret);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64url");
}

export function decryptToken(secret: string, ciphertext: string): string {
  const key = keyBytes(secret);
  const raw = Buffer.from(ciphertext, "base64url");
  if (raw.length < 28) throw new Error("invalid ciphertext");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const data = raw.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

/** OAuth state: userId|label|expMs — encrypted, TTL checked on decode. */
export function encodeOAuthState(
  secret: string,
  userId: string,
  label: string,
  ttlSeconds = 15 * 60,
): string {
  const exp = Date.now() + ttlSeconds * 1000;
  return encryptToken(secret, `${userId}|${label}|${exp}`);
}

export function decodeOAuthState(
  secret: string,
  state: string,
): { userId: string; label: string } {
  const raw = decryptToken(secret, state);
  const [userId, label, expStr] = raw.split("|");
  if (!userId || !label || !expStr) throw new Error("invalid oauth state");
  if (Date.now() > Number(expStr)) throw new Error("oauth state expired");
  return { userId, label };
}
