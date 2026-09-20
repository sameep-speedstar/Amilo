import type {
  BookingIntent,
  BookingResult,
  BrowserSkillRunner,
  SelectionOption,
} from "@amilo/booking";
import { getSiteAdapter } from "./adapters/registry.js";
import { parseSelectionIds } from "./adapters/grocery.js";
import type { SiteAdapter } from "./adapters/types.js";
import { auditOtpRelayed, createMemoryOtpStore, type OtpStore } from "./otpStore.js";
import type { SessionPool } from "./sessionPool.js";
import { runDiningSkill } from "./skills/dining.js";

export type JobState = {
  id: string;
  userId: string;
  intent: BookingIntent;
  phase: "otp" | "select" | "confirm" | "pay_link" | "done" | "failed";
  draft?: BookingResult;
  otpChannel?: "mobile" | "email";
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
 * Implements BrowserSkillRunner via SiteAdapter registry (live)
 * and simulated vertical demos (demo mode).
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

  rehydrateJob(job: {
    id: string;
    userId: string;
    intent: BookingIntent;
    phase: string;
    draft?: BookingResult;
  }): void {
    const phase = normalizePhase(job.phase);
    const state: JobState = {
      id: job.id,
      userId: job.userId,
      intent: job.intent,
      phase,
      updatedAt: Date.now(),
    };
    if (job.draft) state.draft = job.draft;
    this.jobs.set(job.id, state);
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
      if (this.mode === "demo") {
        result = await this.demoStart(intent, jobId, userId);
      } else {
        result = await this.liveStart(intent, jobId, userId);
      }
    } catch (err) {
      result = {
        status: "failed",
        message: err instanceof Error ? err.message : String(err),
      };
    }

    this.storeJob(jobId, userId, intent, result);
    if (
      result.status === "needs_otp" ||
      result.status === "ready_confirm" ||
      result.status === "pay_link" ||
      result.status === "needs_selection"
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
      return this.demoAfterOtp(job, jobId);
    }

    try {
      const adapter = getSiteAdapter(job.intent.merchant);
      const session = await this.pool.getSession(job.userId);
      const step = await adapter.submitOtp(session.page, otp);
      if (step.kind === "needs_otp") {
        const result: BookingResult = {
          status: "needs_otp",
          merchant: job.intent.merchant,
          jobId,
          message: step.message,
          otpChannel: step.channel,
        };
        job.draft = result;
        return result;
      }
      if (step.kind === "blocked") {
        return { status: "blocked", merchant: job.intent.merchant, message: step.reason };
      }
      await this.pool.persist(job.userId).catch(() => undefined);
      const searched = await adapter.search(session.page, job.intent, jobId);
      this.applyDraft(job, searched);
      return searched;
    } catch (err) {
      return {
        status: "failed",
        message: `OTP step failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  async selectOptions(jobId: string, selection: string): Promise<BookingResult> {
    const job = this.jobs.get(jobId);
    if (!job) return { status: "failed", message: "Booking job expired — start again." };

    if (this.mode === "demo") {
      return this.demoSelect(job, jobId, selection);
    }

    const options: SelectionOption[] =
      job.draft?.status === "needs_selection" ? job.draft.options : [];
    const picks = parseSelectionIds(selection, options);
    if (!picks.length) {
      return {
        status: "needs_selection",
        merchant: job.intent.merchant,
        jobId,
        message: "Couldn't parse picks — reply with option ids from the list (e.g. 1 3).",
        options,
      };
    }

    try {
      const adapter = getSiteAdapter(job.intent.merchant);
      const session = await this.pool.getSession(job.userId);
      const result = await adapter.applySelection(
        session.page,
        job.intent,
        jobId,
        picks,
        options,
      );
      this.applyDraft(job, result);
      await this.pool.persist(job.userId).catch(() => undefined);
      return result;
    } catch (err) {
      return {
        status: "failed",
        message: `Select failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  async confirmPlace(jobId: string): Promise<BookingResult> {
    const job = this.jobs.get(jobId);
    if (!job) return { status: "failed", message: "Booking job expired — start again." };
    if (job.phase === "pay_link" && job.draft?.status === "pay_link") {
      return job.draft;
    }

    if (this.mode === "demo") {
      return this.demoPlace(job);
    }

    if (
      !job.draft ||
      (job.draft.status !== "ready_confirm" &&
        job.draft.status !== "pay_link" &&
        job.draft.status !== "needs_selection")
    ) {
      return { status: "failed", message: "Nothing ready to place — start again." };
    }

    try {
      const adapter = getSiteAdapter(job.intent.merchant);
      const session = await this.pool.getSession(job.userId);
      const result = await adapter.place(session.page, job.draft);
      this.applyDraft(job, result);
      await this.pool.persist(job.userId).catch(() => undefined);
      return result;
    } catch (err) {
      return {
        status: "failed",
        message: `Place failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  private async liveStart(
    intent: BookingIntent,
    jobId: string,
    userId: string,
  ): Promise<BookingResult> {
    const adapter = getSiteAdapter(intent.merchant);
    const session = await this.pool.getSession(userId);
    const loginCtx: { phoneE164: string; email?: string | null } = {
      phoneE164: intent.phone,
    };
    if (intent.email != null) loginCtx.email = intent.email;
    const step = await adapter.login(session.page, loginCtx);
    if (step.kind === "logged_in") {
      return adapter.search(session.page, intent, jobId);
    }
    if (step.kind === "needs_otp") {
      return {
        status: "needs_otp",
        merchant: intent.merchant,
        jobId,
        message: step.message,
        otpChannel: step.channel,
      };
    }
    if (step.kind === "need_email") {
      return {
        status: "blocked",
        merchant: intent.merchant,
        message: step.message,
        alternatives: altFor(adapter),
      };
    }
    return {
      status: "blocked",
      merchant: intent.merchant,
      message: step.reason,
      alternatives: altFor(adapter),
    };
  }

  private async demoStart(
    intent: BookingIntent,
    jobId: string,
    userId: string,
  ): Promise<BookingResult> {
    if (intent.vertical === "dining") {
      return runDiningSkill({
        intent,
        jobId,
        mode: "demo",
        pool: this.pool,
        userId,
      });
    }
    if (intent.vertical === "ticketing") {
      return {
        status: "needs_otp",
        merchant: intent.merchant,
        jobId,
        message: `Demo mode — no real ${cap(intent.merchant)} SMS. Reply with any 6-digit code (e.g. 123456) to continue.`,
        otpChannel: "mobile",
      };
    }
    if (intent.vertical === "cab") {
      return {
        status: "needs_otp",
        merchant: intent.merchant,
        jobId,
        message: `Demo mode — no real ${cap(intent.merchant)} SMS. Reply with any 6-digit code to continue.`,
        otpChannel: "mobile",
      };
    }
    // grocery / generic
    return {
      status: "needs_otp",
      merchant: intent.merchant,
      jobId,
      message: `Demo mode — no real ${cap(intent.merchant)} SMS. Reply with any 6-digit code (e.g. 123456) to continue the dry run.`,
      otpChannel: "mobile",
    };
  }

  private demoAfterOtp(job: JobState, jobId: string): BookingResult {
    if (job.intent.vertical === "grocery" || job.intent.vertical === "generic") {
      return groceryPicksAfterOtp(job, jobId);
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
    if (job.intent.vertical === "cab") {
      const dest = job.intent.destinationHint ?? "your destination";
      const result: BookingResult = {
        status: "needs_selection",
        merchant: job.intent.merchant,
        jobId,
        message: `Cab to ${dest} (demo) — pick:`,
        options: [
          { id: "1", label: "Go / Mini", unitInr: 180 },
          { id: "2", label: "Sedan", unitInr: 240 },
          { id: "3", label: "Auto", unitInr: 120 },
        ],
      };
      job.phase = "select";
      job.draft = result;
      return result;
    }
    return diningAfterOtp(job);
  }

  private demoSelect(job: JobState, jobId: string, selection: string): BookingResult {
    if (job.intent.vertical === "cab") {
      const options =
        job.draft?.status === "needs_selection" ? job.draft.options : [];
      const picks = parseSelectionIds(selection, options);
      const chosen = options.find((o) => picks.includes(o.id)) ?? options[0];
      if (!chosen) {
        return {
          status: "needs_selection",
          merchant: job.intent.merchant,
          jobId,
          message: "Pick 1, 2, or 3.",
          options,
        };
      }
      const result: BookingResult = {
        status: "ready_confirm",
        merchant: job.intent.merchant,
        paymentMode: "none",
        jobId,
        summary: `Ride · ${chosen.label} to ${job.intent.destinationHint ?? "destination"} · ~₹${chosen.unitInr}`,
        totalInr: chosen.unitInr ?? null,
        lines: [
          {
            id: chosen.id,
            label: chosen.label,
            qty: 1,
            unitInr: chosen.unitInr ?? null,
          },
        ],
        address: job.intent.destinationHint ?? null,
      };
      job.phase = "confirm";
      job.draft = result;
      return result;
    }

    // grocery-style demo picks (legacy milk/cheese ids)
    const milk = selection.match(/\b(?:milk\s*)?([123])\b/i)?.[1];
    const cheese = selection.match(/\b(?:cheese\s*)?([ABab])\b/i)?.[1]?.toUpperCase();
    const options =
      job.draft?.status === "needs_selection" ? job.draft.options : [];
    const byId = parseSelectionIds(selection, options);
    if (byId.length) {
      const chosen = options.filter((o) => byId.includes(o.id));
      const total = chosen.reduce((s, o) => s + (o.unitInr ?? 0), 0);
      const result: BookingResult = {
        status: "ready_confirm",
        merchant: job.intent.merchant,
        paymentMode: "cod",
        jobId,
        summary: `Cart ready: ${chosen.map((c) => c.label).join(" + ")}. Item total ₹${total}.`,
        totalInr: total,
        lines: chosen.map((c) => ({
          id: c.id,
          label: c.label,
          qty: 1,
          unitInr: c.unitInr ?? null,
        })),
        address: job.intent.addressHint ?? "your saved address",
      };
      job.phase = "confirm";
      job.draft = result;
      return result;
    }

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
        message: "Couldn't parse picks — send e.g. 1 4 or Milk 3; Cheese A",
        options,
      };
    }
    const result: BookingResult = {
      status: "ready_confirm",
      merchant: job.intent.merchant,
      paymentMode: "cod",
      jobId,
      summary: `Cart ready: ${lines.map((l) => `${l.qty} x ${l.label}`).join(" + ")}. Item total ₹${total}.`,
      totalInr: total,
      lines,
      address: job.intent.addressHint ?? "your saved address",
    };
    job.phase = "confirm";
    job.draft = result;
    return result;
  }

  private async demoPlace(job: JobState): Promise<BookingResult> {
    if (job.phase === "pay_link" && job.draft?.status === "pay_link") return job.draft;
    const orderId = `AMILO-${job.intent.merchant.toUpperCase()}-${Date.now().toString(36)}`;
    const result: BookingResult = {
      status: "placed",
      merchant: job.intent.merchant,
      orderId,
      summary:
        job.draft?.status === "ready_confirm"
          ? `${job.draft.summary}\nPlaced (demo).`
          : `Order placed (${job.intent.merchant}) · demo.`,
    };
    job.phase = "done";
    job.draft = result;
    await this.pool.persist(job.userId).catch(() => undefined);
    return result;
  }

  private storeJob(
    jobId: string,
    userId: string,
    intent: BookingIntent,
    result: BookingResult,
  ): void {
    const state: JobState = {
      id: jobId,
      userId,
      intent,
      phase: phaseFor(result),
      draft: result,
      updatedAt: Date.now(),
    };
    if (result.status === "needs_otp" && result.otpChannel) {
      state.otpChannel = result.otpChannel;
    }
    this.jobs.set(jobId, state);
  }

  private applyDraft(job: JobState, result: BookingResult): void {
    job.draft = result;
    job.phase = phaseFor(result);
    job.updatedAt = Date.now();
  }

  private async progress(userId: string, text: string): Promise<void> {
    if (this.onProgress) await this.onProgress(userId, text);
  }
}

function phaseFor(
  result: BookingResult,
): JobState["phase"] {
  switch (result.status) {
    case "needs_otp":
      return "otp";
    case "needs_selection":
      return "select";
    case "ready_confirm":
      return "confirm";
    case "pay_link":
      return "pay_link";
    case "placed":
      return "done";
    default:
      return "failed";
  }
}

function normalizePhase(phase: string): JobState["phase"] {
  if (
    phase === "otp" ||
    phase === "select" ||
    phase === "confirm" ||
    phase === "pay_link" ||
    phase === "done" ||
    phase === "failed"
  ) {
    return phase;
  }
  if (phase === "needs_otp") return "otp";
  if (phase === "needs_selection") return "select";
  if (phase === "ready_confirm") return "confirm";
  return "failed";
}

function altFor(adapter: SiteAdapter): import("@amilo/booking").BookingMerchant[] {
  if (adapter.vertical === "grocery") return ["zepto", "blinkit"];
  if (adapter.vertical === "ticketing") return ["bookmyshow"];
  if (adapter.vertical === "cab") return ["uber", "ola"];
  return [];
}

function cryptoRandom(): string {
  return globalThis.crypto?.randomUUID?.() ?? `job-${Date.now()}`;
}

function groceryPicksAfterOtp(job: JobState, jobId: string): BookingResult {
  const result: BookingResult = {
    status: "needs_selection",
    merchant: job.intent.merchant,
    jobId,
    message: `${cap(job.intent.merchant)} picks:`,
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

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
