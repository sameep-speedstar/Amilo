import type { BookingIntent, BookingResult } from "@amilo/booking";
import type { SessionPool } from "../sessionPool.js";
import { requestPhoneOtp } from "./phoneLogin.js";

export async function runGrocerySkill(opts: {
  intent: BookingIntent;
  jobId: string;
  mode: "demo" | "live";
  pool: SessionPool;
  userId: string;
}): Promise<BookingResult> {
  const { intent, jobId, mode, pool, userId } = opts;

  if (mode === "demo") {
    // Dry-run: no merchant SMS — any code continues the demo cart flow.
    return {
      status: "needs_otp",
      merchant: intent.merchant,
      jobId,
      message: `Demo mode — no real ${capitalize(intent.merchant)} SMS. Reply with any 6-digit code (e.g. 123456) to continue the dry run.`,
    };
  }

  // Live: open merchant, enter phone, request OTP — only then ask WA for the code.
  try {
    const session = await pool.getSession(userId);
    const url =
      intent.merchant === "blinkit"
        ? "https://blinkit.com"
        : intent.merchant === "bigbasket"
          ? "https://www.bigbasket.com"
          : "https://www.zepto.com";

    const otpReq = await requestPhoneOtp({
      page: session.page,
      merchant: intent.merchant,
      phoneE164: intent.phone,
      homeUrl: url,
    });

    if (!otpReq.ok) {
      return {
        status: "blocked",
        merchant: intent.merchant,
        message: otpReq.reason,
        alternatives: (["zepto", "blinkit", "bigbasket"] as const).filter(
          (m) => m !== intent.merchant,
        ) as Array<"zepto" | "blinkit" | "bigbasket">,
      };
    }

    return {
      status: "needs_otp",
      merchant: intent.merchant,
      jobId,
      message: `${capitalize(intent.merchant)} should text a login code to ••••${otpReq.phoneLast4}. Forward that OTP here (don't share it elsewhere).`,
    };
  } catch (err) {
    return {
      status: "blocked",
      merchant: intent.merchant,
      message: `Couldn't reach ${intent.merchant}: ${err instanceof Error ? err.message : String(err)}`,
      alternatives: ["blinkit", "zepto"],
    };
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
