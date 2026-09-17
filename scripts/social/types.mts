export type Platform = "x" | "instagram";

export type SocialPost = {
  id: string;
  date: string;
  platforms: Platform[];
  mockup: string;
  hook: string;
  copy: {
    x?: string;
    instagram?: string;
    story?: string;
  };
};

export type ChatMessage = {
  who: "amilo" | "user";
  time: string;
  text?: string;
  kind?: "text" | "voice";
};

export type Mockup = {
  id: string;
  kicker: string;
  headline: string;
  dayChip?: string;
  beats: Array<{
    id: string;
    messages: ChatMessage[];
  }>;
};

export type LedgerEntry = {
  x?: string;
  instagram?: string;
  story?: string;
  at: string;
};

export type Ledger = Record<string, LedgerEntry>;
