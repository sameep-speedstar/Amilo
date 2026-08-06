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
  /** If the user replied to a specific message (WhatsApp quote). */
  replyToMessageId?: string;
  /** Body of the quoted message when we can resolve it from message_log. */
  replyToContent?: string;
  /** in | out for the quoted message. */
  replyToDirection?: "in" | "out";
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
  /** Returns upstream message id when the channel provides one (e.g. wamid). */
  send(userId: string, message: OutboundMessage): Promise<string | void>;
}
