/** Short-TTL OTP holding — never persist to message_log. Redis when available, else memory. */

type Entry = { otp: string; expiresAt: number };

const mem = new Map<string, Entry>();

export type OtpStore = {
  put(jobId: string, otp: string, ttlMs?: number): Promise<void>;
  take(jobId: string): Promise<string | null>;
};

export function createMemoryOtpStore(): OtpStore {
  return {
    async put(jobId, otp, ttlMs = 5 * 60_000) {
      mem.set(jobId, { otp, expiresAt: Date.now() + ttlMs });
    },
    async take(jobId) {
      const e = mem.get(jobId);
      mem.delete(jobId);
      if (!e || e.expiresAt < Date.now()) return null;
      return e.otp;
    },
  };
}

/** Audit without storing code. */
export function auditOtpRelayed(opts: {
  userId: string;
  jobId: string;
  merchant: string;
}): void {
  console.info(
    JSON.stringify({
      event: "booking_otp_relayed",
      userId: opts.userId,
      jobId: opts.jobId,
      merchant: opts.merchant,
      // never log otp
    }),
  );
}
