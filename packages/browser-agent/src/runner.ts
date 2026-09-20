import type {
  BookingIntent,
  BookingResult,
  BrowserSkillRunner,
} from "@amilo/booking";
import { auditOtpRelayed, createMemoryOtpStore, type OtpStore } from "./otpStore.js";
import type { SessionPool } from "./sessionPool.js";
import { runGrocerySkill } from "./skills/grocery.js";
import { runDiningSkill } from "./skills/dining.js";
import { runTicketingSkill } from "./skills/ticketing.js";

export type JobState = {
  id: string;
  userId: string;
  intent: BookingIntent;
  phase: "otp" | "select" | "confirm" | "pay_link" | "done" | "failed";
  draft?: BookingResult;
  updatedAt: number;
};

export type BrowserAgentOpts = {
  pool: SessionPool;
  mode?: "demo" | "live";
  otpStore?: OtpStore;
  onProgress?: (userId: string, text: string) => Promise<void>;
};

export type AgentBookingIntent = BookingIntent & { userId: string };

/**
 * Implements BrowserSkillRunner for BookingConnector.
 */
export class BrowserAgentRunner implements BrowserSkillRunner {
  private pool: SessionPool;
  private mode: "demo" | "live";
  private otp: OtpStore;
  private jobs = new Map<string, JobState>();
  private onProgress: ((userId: string, text: string) => Promise<void>) | undefined;
  private defaultUserId: string | null = null;

  constructor(opts: BrowserAgentOpts) {
    this.pool = opts.pool;
    this.mode = opts.mode ?? (process.env.BROWSER_AGENT_MODE === "live" ? "live" : "demo");
    this.otp = opts.otpStore ?? createMemoryOtpStore();
    this.onProgress = opts.onProgress;
  }

  setDefaultUserId(userId: string): void {
    this.defaultUserId = userId;
  }

  getJob(jobId: string): JobState | undefined {
    return this.jobs.get(jobId);
  }

  async start(intent: BookingIntent): Promise<BookingResult> {
    const userId =
      (intent as AgentBookingIntent).userId || this.defaultUserId || intent.phone;
    return this.startForUser(userId, intent);
  }

  async startForUser(userId: string, intent: BookingIntent): Promise<BookingResult> {
    const jobId = cryptoRandom();
    await this.progress(userId, `Opening ${intent.merchant}…`);

    let result: BookingResult;
    try {
      if (intent.vertical === "grocery") {
        result = await runGrocerySkill({
          intent,
          jobId,
          mode: this.mode,
          pool: this.pool,
          userId,
        });
      } else if (intent.vertical === "dining") {
        result = await runDiningSkill({
          intent,
          jobId,
          mode: this.mode,
          pool: this.pool,
          userId,
        });
      } else if (intent.vertical === "ticketing") {
        result = await runTicketingSkill({
          intent,
          jobId,
          mode: this.mode,
          pool: this.pool,
          userId,
        });
      } else {
        result = {
          status: "failed",
          message: `No browser skill for ${intent.vertical} yet — name Zepto / Zomato / BookMyShow.`,
        };
      }
    } catch (err) {
      result = {
        status: "failed",
        message: err instanceof Error ? err.message : String(err),
      };
    }

    const phase =
      result.status === "needs_otp"
        ? "otp"
        : result.status === "needs_selection"
          ? "select"
          : result.status === "ready_confirm"
            ? "confirm"
            : result.status === "pay_link"
              ? "pay_link"
              : result.status === "placed"
                ? "done"
                : "failed";

    this.jobs.set(jobId, {
      id: jobId,
      userId,
      intent,
      phase,
      draft: result,
      updatedAt: Date.now(),
    });

    if (
      result.status === "needs_otp" ||
      result.status === "ready_confirm" ||
      result.status === "pay_link"
    ) {
      await this.pool.persist(userId).catch(() => undefined);
    }
    return result;
  }

  async submitOtp(jobId: string, otp: string): Promise<BookingResult> {
    const job = this.jobs.get(jobId);
    if (!job) return { status: "failed", message: "Booking job expired — start again." };
    await this.otp.put(jobId, otp);
    auditOtpRelayed({
      userId: job.userId,
      jobId,
      merchant: job.intent.merchant,
    });
    await this.progress(job.userId, `Signing into ${job.intent.merchant}…`);

    if (this.mode === "demo") {
      if (job.intent.vertical === "grocery") {
        const result: BookingResult = {
          status: "needs_selection",
          merchant: job.intent.merchant,
          jobId,
          message: "Zepto picks (demo):",
          options: [
            { id: "1", label: "Amul Taaza 500ml", unitInr: 29 },
            { id: "2", label: "Nandini toned 500ml", unitInr: 24 },
            { id: "3", label: "Amul Gold full cream 500ml", unitInr: 34 },
            { id: "A", label: "Amul cheese slices 200g", unitInr: 137 },
            { id: "B", label: "Go slices 200g", unitInr: 109 },
          ],
        };
        job.phase = "select";
        job.draft = result;
        return result;
      }
      if (job.intent.vertical === "ticketing") {
        const result: BookingResult = {
          status: "pay_link",
          merchant: job.intent.merchant,
          paymentMode: "prepaid_link",
          jobId,
          summary: `Seats held · ${job.intent.movieHint ?? job.intent.query.slice(0, 60)}`,
          totalInr: 480,
          payUrl: "https://in.bookmyshow.com/checkout/demo-pay",
        };
        job.phase = "pay_link";
        job.draft = result;
        return result;
      }
      if (job.intent.vertical === "dining") {
        return diningAfterOtp(job);
      }
    }

    return this.startForUser(job.userId, job.intent);
  }

  async selectOptions(jobId: string, selection: string): Promise<BookingResult> {
    const job = this.jobs.get(jobId);
    if (!job) return { status: "failed", message: "Booking job expired — start again." };

    const milk = selection.match(/\b(?:milk\s*)?([123])\b/i)?.[1];
    const cheese = selection.match(/\b(?:cheese\s*)?([ABab])\b/i)?.[1]?.toUpperCase();
    const milkMap: Record<string, { label: string; unit: number; qty: number }> = {
      "1": { label: "Amul Taaza 500ml", unit: 29, qty: 1 },
      "2": { label: "Nandini toned 500ml", unit: 24, qty: 1 },
      "3": { label: "Amul Gold 500ml", unit: 34, qty: 2 },
    };
    const cheeseMap: Record<string, { label: string; unit: number; qty: number }> = {
      A: { label: "Amul cheese slices 200g", unit: 137, qty: 1 },
      B: { label: "Go slices 200g", unit: 109, qty: 1 },
    };
    const lines: Array<{ id: string; label: string; qty: number; unitInr: number }> = [];
    let total = 0;
    if (milk && milkMap[milk]) {
      const m = milkMap[milk]!;
      lines.push({ id: milk, label: m.label, qty: m.qty, unitInr: m.unit });
      total += m.unit * m.qty;
    }
    if (cheese && cheeseMap[cheese]) {
      const c = cheeseMap[cheese]!;
      lines.push({ id: cheese, label: c.label, qty: c.qty, unitInr: c.unit });
      total += c.unit * c.qty;
    }
    if (!lines.length) {
      return {
        status: "needs_selection",
        merchant: job.intent.merchant,
        jobId,
        message: "Couldn't parse picks — send e.g. Milk 3; Cheese A",
        options:
          job.draft && job.draft.status === "needs_selection" ? job.draft.options : [],
      };
    }

    const address = job.intent.addressHint ?? "your saved address";
    const result: BookingResult = {
      status: "ready_confirm",
      merchant: job.intent.merchant,
      paymentMode: "cod",
      jobId,
      summary: `Cart ready: ${lines.map((l) => `${l.qty} x ${l.label}`).join(" + ")}. Item total ₹${total}, delivering to ${address}.`,
      totalInr: total,
      lines,
      address,
    };
    job.phase = "confirm";
    job.draft = result;
    return result;
  }

  async confirmPlace(jobId: string): Promise<BookingResult> {
    const job = this.jobs.get(jobId);
    if (!job) return { status: "failed", message: "Booking job expired — start again." };
    if (job.phase === "pay_link" && job.draft?.status === "pay_link") {
      return job.draft;
    }
    const orderId = `AMILO-${job.intent.merchant.toUpperCase()}-${Date.now().toString(36)}`;
    const result: BookingResult = {
      status: "placed",
      merchant: job.intent.merchant,
      orderId,
      summary:
        job.draft?.status === "ready_confirm"
          ? `${job.draft.summary}\nPlaced with pay on delivery.`
          : `Order placed (${job.intent.merchant}) · COD.`,
    };
    job.phase = "done";
    job.draft = result;
    await this.pool.persist(job.userId).catch(() => undefined);
    return result;
  }

  private async progress(userId: string, text: string): Promise<void> {
    if (this.onProgress) await this.onProgress(userId, text);
  }
}

function cryptoRandom(): string {
  return globalThis.crypto?.randomUUID?.() ?? `job-${Date.now()}`;
}

function diningAfterOtp(job: JobState): BookingResult {
  const intent = job.intent;
  const venue = intent.venueHint ?? "the restaurant";
  const when = intent.whenHint ?? "your preferred slot";
  const party = intent.partySize ?? 2;
  const result: BookingResult = {
    status: "ready_confirm",
    merchant: intent.merchant,
    paymentMode: "venue",
    jobId: job.id,
    summary: `Table for ${party} · ${venue} · ${when} (pay at venue).`,
    totalInr: null,
    lines: [],
    address: venue,
  };
  job.phase = "confirm";
  job.draft = result;
  return result;
}
