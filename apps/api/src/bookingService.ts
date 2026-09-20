import {
  BookingConnector,
  PARTNER_API_STUBS,
  formatBookingResultForWa,
  parseBookingIntent,
  parseBookingOtpReply,
  type BookingIntent,
  type BookingResult,
} from "@amilo/booking";
import {
  BrowserAgentRunner,
  SessionPool,
  createProfileStoreFromEnv,
} from "@amilo/browser-agent";
import {
  createBrowserJob,
  createPendingAction,
  updateBrowserJob,
  upsertBrowserProfile,
  type Db,
  type PendingActionKind,
} from "@amilo/db";
import type { OutboundMessage } from "@amilo/core";

let connector: BookingConnector | null = null;
let agent: BrowserAgentRunner | null = null;
let pool: SessionPool | null = null;

export function getBookingAgent(): {
  connector: BookingConnector;
  agent: BrowserAgentRunner;
  pool: SessionPool;
} {
  if (!connector || !agent || !pool) {
    const profiles = createProfileStoreFromEnv();
    pool = new SessionPool({ profiles });
    agent = new BrowserAgentRunner({
      pool,
      mode: process.env.BROWSER_AGENT_MODE === "live" ? "live" : "demo",
    });
    connector = new BookingConnector({
      adapters: PARTNER_API_STUBS,
      browser: agent,
      allowAnySite: process.env.BOOKING_ALLOW_ANY_SITE === "1",
    });
  }
  return { connector, agent, pool };
}

function pendingKindFor(result: BookingResult): PendingActionKind | null {
  switch (result.status) {
    case "needs_otp":
      return "booking_otp";
    case "needs_selection":
      return "booking_select";
    case "ready_confirm":
      return "booking_confirm";
    case "pay_link":
      return "booking_pay_link";
    default:
      return null;
  }
}

function summaryFor(result: BookingResult): string {
  return formatBookingResultForWa(result).slice(0, 900);
}

export async function startBookingFlow(
  db: Db,
  opts: { userId: string; phone: string; text: string },
): Promise<OutboundMessage[] | null> {
  const intent = parseBookingIntent(opts.text, opts.phone);
  if (!intent) return null;

  const { connector, agent } = getBookingAgent();
  agent.setDefaultUserId(opts.userId);
  await upsertBrowserProfile(db, { userId: opts.userId, status: "busy" });

  const result = await connector.fulfill(intent);
  return persistAndReply(db, opts.userId, intent, result);
}

export async function continueBookingOtp(
  db: Db,
  opts: { userId: string; jobId: string; otp: string },
): Promise<OutboundMessage[]> {
  const { connector } = getBookingAgent();
  const result = await connector.submitOtp(opts.jobId, opts.otp);
  await updateBrowserJob(db, opts.jobId, {
    status: result.status,
    result: result as unknown as Record<string, unknown>,
    pendingKind: pendingKindFor(result),
  });
  return afterResult(db, opts.userId, result);
}

export async function continueBookingSelect(
  db: Db,
  opts: { userId: string; jobId: string; selection: string },
): Promise<OutboundMessage[]> {
  const { connector } = getBookingAgent();
  const result = await connector.selectOptions(opts.jobId, opts.selection);
  await updateBrowserJob(db, opts.jobId, {
    status: result.status,
    result: result as unknown as Record<string, unknown>,
    pendingKind: pendingKindFor(result),
  });
  return afterResult(db, opts.userId, result);
}

export async function confirmBookingPlace(
  db: Db,
  opts: { userId: string; jobId: string },
): Promise<{ ok: boolean; message: string }> {
  const { connector } = getBookingAgent();
  const result = await connector.confirmPlace(opts.jobId);
  await updateBrowserJob(db, opts.jobId, {
    status: result.status,
    result: result as unknown as Record<string, unknown>,
  });
  await upsertBrowserProfile(db, { userId: opts.userId, status: "idle" });
  return { ok: result.status === "placed", message: formatBookingResultForWa(result) };
}

async function persistAndReply(
  db: Db,
  userId: string,
  intent: BookingIntent,
  result: BookingResult,
): Promise<OutboundMessage[]> {
  const jobId =
    "jobId" in result && typeof (result as { jobId?: string }).jobId === "string"
      ? (result as { jobId: string }).jobId
      : undefined;

  if (jobId) {
    await createBrowserJob(db, {
      id: jobId,
      userId,
      merchant: intent.merchant,
      vertical: intent.vertical,
      intent: intent as unknown as Record<string, unknown>,
      status: result.status,
      pendingKind: pendingKindFor(result),
      result: result as unknown as Record<string, unknown>,
    });
  }

  return afterResult(db, userId, result);
}

async function afterResult(
  db: Db,
  userId: string,
  result: BookingResult,
): Promise<OutboundMessage[]> {
  const kind = pendingKindFor(result);
  const text = formatBookingResultForWa(result);
  if (!kind) {
    await upsertBrowserProfile(db, { userId, status: "idle" });
    return [{ text }];
  }

  const jobId =
    "jobId" in result ? String((result as { jobId: string }).jobId) : "";
  const payload: Record<string, unknown> = {
    jobId,
    merchant: "merchant" in result ? result.merchant : null,
    result,
  };
  if (result.status === "pay_link") {
    payload.payUrl = result.payUrl;
    payload.totalInr = result.totalInr;
  }
  if (result.status === "ready_confirm") {
    payload.paymentMode = result.paymentMode;
    payload.totalInr = result.totalInr;
  }

  const pending = await createPendingAction(db, {
    userId,
    kind,
    summary: summaryFor(result),
    payload,
    expiresInMs: kind === "booking_otp" ? 10 * 60_000 : 2 * 60 * 60_000,
  });

  if (kind === "booking_pay_link") {
    return [
      {
        text: [
          `Proposed (${pending.kind}):`,
          pending.summary,
        ].join("\n"),
      },
    ];
  }

  return [
    {
      text: [
        `Proposed (${pending.kind}):`,
        pending.summary,
        kind === "booking_confirm" ? "\nReply yes to place, cancel to drop." : "",
      ]
        .filter(Boolean)
        .join("\n"),
    },
  ];
}

export function tryParseBookingIntent(text: string, phone: string): BookingIntent | null {
  return parseBookingIntent(text, phone);
}

export { parseBookingOtpReply };
