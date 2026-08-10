/** Exact / near-exact standing WhatsApp commands (bypass the brain). */

export function normalizeCommandText(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[?.!]+$/g, "")
    .replace(/\s+/g, " ");
}

export function isHelpCommand(text: string): boolean {
  const t = normalizeCommandText(text);
  return t === "help" || t === "commands" || t === "command" || t === "menu";
}

export function isHowItWorksCommand(text: string): boolean {
  const t = normalizeCommandText(text);
  return (
    t === "how it works" ||
    t === "how does it work" ||
    t === "how does this work" ||
    t === "how does amilo work" ||
    t === "how do you work" ||
    t === "how amilo works"
  );
}

export function isStatusCommand(text: string): boolean {
  const t = normalizeCommandText(text);
  return (
    t === "status" ||
    t === "pending" ||
    t === "open" ||
    t === "what's pending" ||
    t === "whats pending" ||
    t === "what's open" ||
    t === "whats open" ||
    t === "show pending" ||
    t === "list pending" ||
    t === "what is pending" ||
    t === "what is open"
  );
}

export function isAboutMeCommand(text: string): boolean {
  const t = normalizeCommandText(text);
  return (
    t === "about me" ||
    t === "memory" ||
    t === "profile" ||
    t === "what do you know" ||
    t === "what do you know about me" ||
    t === "what you know about me" ||
    t === "show memory"
  );
}

export function isDeleteMenuCommand(text: string): boolean {
  const t = normalizeCommandText(text);
  return t === "delete" || t === "remove" || t === "forget";
}

export function parseForgetCommand(text: string): string | null {
  const m = text.trim().match(/^(?:forget|delete memory|remove memory)\s+(.+)$/i);
  if (!m?.[1]) return null;
  const label = m[1].replace(/[?.!]+$/g, "").trim();
  if (!label || /^(pending|all|memory|me)$/i.test(label)) return null;
  return label.slice(0, 120);
}

export function isDeletePendingCommand(text: string): boolean {
  const t = normalizeCommandText(text);
  return (
    t === "delete pending" ||
    t === "drop pending" ||
    t === "clear pending" ||
    t === "cancel pending"
  );
}

export function isClearMemoryCommand(text: string): boolean {
  const t = normalizeCommandText(text);
  return t === "clear memory" || t === "wipe memory" || t === "delete memory";
}

export function isClearMemoryConfirmCommand(text: string): boolean {
  const t = normalizeCommandText(text);
  return (
    t === "clear memory yes" ||
    t === "wipe memory yes" ||
    t === "delete memory yes" ||
    t === "yes clear memory"
  );
}

export const STANDING_HELP = [
  "Amilo — quick commands",
  "",
  "Basics",
  "• help / commands — this list",
  "• how it works — what Amilo does",
  "• pause / resume — stop or restart",
  "• status / pending / open — waiting proposal + open items",
  "• about me / memory — what I've stored (only when you ask)",
  "",
  "Google",
  "• connect google personal — link Gmail + Calendar",
  "• google — list linked accounts",
  "• disconnect google <label|all> — unlink (LifeOS untouched)",
  "• sync — refresh mail + today's calendar",
  "• brief — curated priorities (also: morning / evening)",
  "",
  "Attention",
  "• mute <phrase> / unmute <phrase> / mutes",
  "• briefs on|off · brief morning 7:30 · brief evening 8pm",
  "• quiet hours 22:00-07:00",
  "• timezone — show or set (I'm in Dubai)",
  "• remind me … at 12:30",
  "",
  "Writes (always confirm)",
  "• Talk normally to book / invite / cancel calendar",
  "• yes — confirm · cancel — drop · edit <change>",
  "",
  "Delete / forget",
  "• delete — what you can remove",
  "• delete pending — drop open proposal",
  "• forget <name> — remove a remembered person/fact",
  "• clear memory yes — wipe learned context",
  "",
  "Voice notes work like text. Everything else: just talk.",
].join("\n");

export const HOW_IT_WORKS = [
  "How Amilo works",
  "",
  "1) I sync Gmail + Calendar when you connect Google.",
  "2) Briefs surface only mail that needs action — not every alert.",
  "3) I remember durable facts quietly (people, roles, prefs).",
  "4) Calendar/email writes need your yes first — I never invent a write.",
  "5) pause stops me; your data stays until you delete/forget.",
  "",
  "Send help for the command list.",
].join("\n");

export const DELETE_MENU = [
  "What you can remove:",
  "• delete pending — drop the open yes/cancel proposal",
  "• forget <name> — e.g. forget Rajeev",
  "• clear memory yes — wipe learned context (people/facts)",
  "• disconnect google <label|all> — unlink Google",
  "",
  "Reminders: say done on that reminder, or cancel when proposed.",
].join("\n");
