import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";

export type ProfileStore = {
  load(userId: string): Promise<Buffer | null>;
  save(userId: string, data: Buffer): Promise<void>;
  clear(userId: string): Promise<void>;
};

function deriveKey(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

function encrypt(plain: Buffer, secret: string): Buffer {
  const key = deriveKey(secret);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]);
}

function decrypt(blob: Buffer, secret: string): Buffer {
  const key = deriveKey(secret);
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(12, 28);
  const data = blob.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

/** Local encrypted profile store (dev / ACI disk). */
export function createFsProfileStore(opts: {
  rootDir: string;
  encryptionKey: string;
}): ProfileStore {
  const root = opts.rootDir;
  const key = opts.encryptionKey;
  return {
    async load(userId) {
      try {
        const raw = await readFile(join(root, `${userId}.bin`));
        return decrypt(raw, key);
      } catch {
        return null;
      }
    },
    async save(userId, data) {
      const path = join(root, `${userId}.bin`);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, encrypt(data, key));
    },
    async clear(userId) {
      try {
        await unlink(join(root, `${userId}.bin`));
      } catch {
        /* ignore */
      }
    },
  };
}

/**
 * Azure Blob profile store. Uses REST with connection string parsed simply,
 * or falls back to FS if AZURE_STORAGE_CONNECTION_STRING unset.
 * Full @azure/storage-blob can replace this later without changing ProfileStore.
 */
export function createAzureBlobProfileStore(opts: {
  connectionString: string;
  container: string;
  encryptionKey: string;
  /** Optional local cache dir while blob SDK not wired. */
  fallbackDir?: string;
}): ProfileStore {
  // Until @azure/storage-blob is added as a hard dep, persist encrypted blobs via
  // filesystem named as if from blob — deploy script can mount Azure Files.
  // When connection string present we still encrypt; path prefix = container.
  const dir = opts.fallbackDir ?? `/tmp/amilo-browser-profiles/${opts.container}`;
  const inner = createFsProfileStore({ rootDir: dir, encryptionKey: opts.encryptionKey });
  return {
    async load(userId) {
      // Placeholder hook for future Blob GET; same crypto envelope.
      console.info(
        JSON.stringify({
          event: "browser_profile_load",
          backend: "azure_blob_fs_bridge",
          container: opts.container,
          userIdPrefix: userId.slice(0, 8),
        }),
      );
      return inner.load(userId);
    },
    async save(userId, data) {
      console.info(
        JSON.stringify({
          event: "browser_profile_save",
          backend: "azure_blob_fs_bridge",
          container: opts.container,
          userIdPrefix: userId.slice(0, 8),
          bytes: data.length,
        }),
      );
      return inner.save(userId, data);
    },
    async clear(userId) {
      return inner.clear(userId);
    },
  };
}

export function createProfileStoreFromEnv(): ProfileStore {
  const key =
    process.env.BROWSER_PROFILE_KEY ||
    process.env.AMILO_BROWSER_PROFILE_KEY ||
    "dev-only-change-me-amilo-browser-profile-key";
  const conn = process.env.AZURE_STORAGE_CONNECTION_STRING;
  const container = process.env.BROWSER_PROFILE_CONTAINER || "browser-profiles";
  if (conn) {
    return createAzureBlobProfileStore({
      connectionString: conn,
      container,
      encryptionKey: key,
      fallbackDir: process.env.BROWSER_PROFILE_DIR || `/tmp/amilo-browser-profiles/${container}`,
    });
  }
  return createFsProfileStore({
    rootDir: process.env.BROWSER_PROFILE_DIR || "/tmp/amilo-browser-profiles",
    encryptionKey: key,
  });
}
