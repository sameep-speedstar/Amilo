/** Channel-blind inbound — adapters normalize into this before core sees it. */

export type ChannelKind = "whatsapp" | "telegram" | "web";

export interface InboundMessage {
  userId: string;
  channel: ChannelKind;
  kind: "text" | "voice" | "button";
  content: string;
  mediaRef?: string;
  /** Upstream message id (e.g. WhatsApp wamid) for graph observation audit. */
  messageId?: string;
  ts: Date;
}

export interface OutboundText {
  text: string;
}

export interface OutboundTemplate {
  templateName: string;
  languageCode: string;
  variables: string[];
}

export type OutboundMessage = OutboundText | OutboundTemplate;

export interface ChannelPort {
  send(userId: string, message: OutboundMessage): Promise<void>;
}
