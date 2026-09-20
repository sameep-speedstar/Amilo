import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import type { ProfileStore } from "./profileStore.js";

export type UserBrowserSession = {
  userId: string;
  context: BrowserContext;
  page: Page;
  lastUsedAt: number;
};

/**
 * One Chromium context per user. Profile cookies persisted via ProfileStore.
 */
export class SessionPool {
  private browser: Browser | null = null;
  private sessions = new Map<string, UserBrowserSession>();
  private profiles: ProfileStore;
  private idleMs: number;
  private headless: boolean;

  constructor(opts: {
    profiles: ProfileStore;
    idleMs?: number;
    headless?: boolean;
  }) {
    this.profiles = opts.profiles;
    this.idleMs = opts.idleMs ?? 45 * 60_000;
    this.headless = opts.headless !== false;
  }

  async ensureBrowser(): Promise<Browser> {
    if (this.browser) return this.browser;
    this.browser = await chromium.launch({
      headless: this.headless,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    return this.browser;
  }

  async getSession(userId: string): Promise<UserBrowserSession> {
    this.evictIdle();
    const existing = this.sessions.get(userId);
    if (existing) {
      existing.lastUsedAt = Date.now();
      return existing;
    }
    const browser = await this.ensureBrowser();
    const stored = await this.profiles.load(userId);
    let context;
    if (stored) {
      const state = JSON.parse(stored.toString("utf8")) as {
        cookies: Array<{
          name: string;
          value: string;
          domain: string;
          path: string;
          expires: number;
          httpOnly: boolean;
          secure: boolean;
          sameSite: "Strict" | "Lax" | "None";
        }>;
        origins: Array<{
          origin: string;
          localStorage: Array<{ name: string; value: string }>;
        }>;
      };
      context = await browser.newContext({ storageState: state });
    } else {
      context = await browser.newContext();
    }
    const page = await context.newPage();
    const session: UserBrowserSession = {
      userId,
      context,
      page,
      lastUsedAt: Date.now(),
    };
    this.sessions.set(userId, session);
    return session;
  }

  async persist(userId: string): Promise<void> {
    const s = this.sessions.get(userId);
    if (!s) return;
    const state = await s.context.storageState();
    await this.profiles.save(userId, Buffer.from(JSON.stringify(state), "utf8"));
  }

  async closeUser(userId: string): Promise<void> {
    const s = this.sessions.get(userId);
    if (!s) return;
    try {
      await this.persist(userId);
    } catch {
      /* ignore */
    }
    await s.context.close().catch(() => undefined);
    this.sessions.delete(userId);
  }

  async clearProfile(userId: string): Promise<void> {
    await this.closeUser(userId);
    await this.profiles.clear(userId);
  }

  private evictIdle(): void {
    const now = Date.now();
    for (const [id, s] of this.sessions) {
      if (now - s.lastUsedAt > this.idleMs) {
        void this.closeUser(id);
      }
    }
  }

  async shutdown(): Promise<void> {
    for (const id of [...this.sessions.keys()]) {
      await this.closeUser(id);
    }
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}
