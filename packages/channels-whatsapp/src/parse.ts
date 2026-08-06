/** WhatsApp Cloud API webhook parsing — normalize into channel-blind inbound. */

export interface ParsedWhatsAppMessage {
  /** Digits only, no leading + (Graph API "from" field). */
  waId: string;
  /** E.164 with leading +. */
  phoneE164: string;
  kind: "text" | "voice" | "button";
  content: string;
  mediaId?: string;
  messageId: string;
  /** wamid of the message the user replied to (WhatsApp quote). */
  replyToMessageId?: string;
  timestamp: Date;
  profileName?: string;
}

export interface WhatsAppWebhookPayload {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{
      field?: string;
      value?: {
        messaging_product?: string;
        metadata?: { phone_number_id?: string; display_phone_number?: string };
        contacts?: Array<{
          wa_id?: string;
          profile?: { name?: string };
        }>;
        messages?: Array<{
          from?: string;
          id?: string;
          timestamp?: string;
          type?: string;
          context?: { id?: string; from?: string };
          text?: { body?: string };
          button?: { text?: string; payload?: string };
          interactive?: {
            type?: string;
            button_reply?: { id?: string; title?: string };
            list_reply?: { id?: string; title?: string };
          };
          audio?: { id?: string; mime_type?: string };
          image?: { id?: string; caption?: string };
        }>;
        statuses?: unknown[];
      };
    }>;
  }>;
}

export function toE164(waId: string): string {
  const digits = waId.replace(/\D/g, "");
  return digits.startsWith("+") ? digits : `+${digits}`;
}

export function normalizePhoneKey(phone: string): string {
  return phone.replace(/\D/g, "");
}

export function isPhoneAllowed(waIdOrE164: string, allowed: string[]): boolean {
  if (allowed.length === 0) return false;
  const key = normalizePhoneKey(waIdOrE164);
  return allowed.some((a) => normalizePhoneKey(a) === key);
}

/**
 * Extract inbound user messages from a Cloud API webhook body.
 * Status callbacks and empty payloads yield [].
 */
export function parseWhatsAppWebhook(body: unknown): ParsedWhatsAppMessage[] {
  const payload = body as WhatsAppWebhookPayload;
  if (payload?.object !== "whatsapp_business_account") return [];

  const out: ParsedWhatsAppMessage[] = [];

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field && change.field !== "messages") continue;
      const value = change.value;
      if (!value?.messages?.length) continue;

      const contactByWa = new Map(
        (value.contacts ?? [])
          .filter((c) => c.wa_id)
          .map((c) => [c.wa_id!, c] as const),
      );

      for (const msg of value.messages) {
        if (!msg.from || !msg.id) continue;
        const parsed = normalizeMessage(msg, contactByWa.get(msg.from)?.profile?.name);
        if (parsed) out.push(parsed);
      }
    }
  }

  return out;
}

function normalizeMessage(
  msg: {
    from?: string;
    id?: string;
    timestamp?: string;
    type?: string;
    context?: { id?: string; from?: string };
    text?: { body?: string };
    button?: { text?: string; payload?: string };
    interactive?: {
      button_reply?: { id?: string; title?: string };
      list_reply?: { id?: string; title?: string };
    };
    audio?: { id?: string };
  },
  profileName?: string,
): ParsedWhatsAppMessage | null {
  const waId = msg.from!;
  const timestamp = msg.timestamp
    ? new Date(Number(msg.timestamp) * 1000)
    : new Date();
  const replyToMessageId = msg.context?.id?.trim() || undefined;
  const base: Omit<ParsedWhatsAppMessage, "kind" | "content" | "mediaId"> = {
    waId,
    phoneE164: toE164(waId),
    messageId: msg.id!,
    timestamp,
    ...(profileName ? { profileName } : {}),
    ...(replyToMessageId ? { replyToMessageId } : {}),
  };

  switch (msg.type) {
    case "text": {
      const body = msg.text?.body?.trim();
      if (!body) return null;
      return { ...base, kind: "text", content: body };
    }
    case "button": {
      const text = msg.button?.text?.trim() || msg.button?.payload?.trim();
      if (!text) return null;
      return { ...base, kind: "button", content: text };
    }
    case "interactive": {
      const title =
        msg.interactive?.button_reply?.title ||
        msg.interactive?.list_reply?.title ||
        msg.interactive?.button_reply?.id ||
        msg.interactive?.list_reply?.id;
      if (!title?.trim()) return null;
      return { ...base, kind: "button", content: title.trim() };
    }
    case "audio": {
      if (!msg.audio?.id) return null;
      return {
        ...base,
        kind: "voice",
        content: "[voice note]",
        mediaId: msg.audio.id,
      };
    }
    default:
      // Ignore reactions, stickers, unsupported — ACK only at API layer.
      return null;
  }
}
