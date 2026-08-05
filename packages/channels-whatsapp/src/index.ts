import { createHmac, timingSafeEqual } from "node:crypto";
import type { ChannelPort, InboundMessage, OutboundMessage, OutboundTemplate } from "@amilo/core";

export interface WabaConfig {
  accessToken: string;
  phoneNumberId: string;
  appSecret: string;
  apiVersion?: string;
}

/** Track last user inbound per WA address for the 24h customer-care window. */
export type WindowStore = {
  getLastInbound(waId: string): Promise<Date | null>;
  setLastInbound(waId: string, at: Date): Promise<void>;
};

const MS_24H = 24 * 60 * 60 * 1000;

export function verifyWebhookSignature(
  appSecret: string,
  rawBody: Buffer,
  signatureHeader: string | undefined,
): boolean {
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const got = signatureHeader.slice("sha256=".length);
  try {
    return timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(got, "utf8"));
  } catch {
    return false;
  }
}

export function isInside24hWindow(lastInbound: Date | null, now = new Date()): boolean {
  if (!lastInbound) return false;
  return now.getTime() - lastInbound.getTime() < MS_24H;
}

export async function sendWhatsAppText(
  cfg: WabaConfig,
  toE164Digits: string,
  text: string,
): Promise<void> {
  const version = cfg.apiVersion ?? "v21.0";
  const url = `https://graph.facebook.com/${version}/${cfg.phoneNumberId}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: toE164Digits.replace(/^\+/, ""),
      type: "text",
      text: { body: text },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`WABA send text failed ${res.status}: ${body}`);
  }
}

export async function sendWhatsAppTemplate(
  cfg: WabaConfig,
  toE164Digits: string,
  template: OutboundTemplate,
): Promise<void> {
  const version = cfg.apiVersion ?? "v21.0";
  const url = `https://graph.facebook.com/${version}/${cfg.phoneNumberId}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: toE164Digits.replace(/^\+/, ""),
      type: "template",
      template: {
        name: template.templateName,
        language: { code: template.languageCode },
        components: [
          {
            type: "body",
            parameters: template.variables.map((text) => ({ type: "text", text })),
          },
        ],
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`WABA send template failed ${res.status}: ${body}`);
  }
}

/**
 * Outbound policy: free-form only inside 24h window; otherwise require template.
 * Briefings should always pass OutboundTemplate from the caller.
 */
export function createWhatsAppChannel(opts: {
  cfg: WabaConfig;
  windows: WindowStore;
  /** Map Amilo userId → WA digits (no plus). */
  resolveAddress: (userId: string) => Promise<string>;
}): ChannelPort {
  return {
    async send(userId: string, message: OutboundMessage): Promise<void> {
      const to = await opts.resolveAddress(userId);
      if ("templateName" in message) {
        await sendWhatsAppTemplate(opts.cfg, to, message);
        return;
      }
      const last = await opts.windows.getLastInbound(to);
      if (!isInside24hWindow(last)) {
        throw new Error(
          "Outside 24h window — free-form send blocked. Use an approved template.",
        );
      }
      await sendWhatsAppText(opts.cfg, to, message.text);
    },
  };
}

/** Minimal normalize stub — full webhook parsing lands in M1. */
export function stubInbound(partial: Omit<InboundMessage, "channel">): InboundMessage {
  return { ...partial, channel: "whatsapp" };
}

export const TEMPLATE_NAMES = {
  morningBriefing: "morning_briefing",
  eveningSummary: "evening_summary",
  priorityAlert: "priority_alert",
} as const;
