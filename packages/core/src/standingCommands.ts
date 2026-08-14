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

/** about <name> / what do you know about <name> — not "about me". */
export function parseAboutPersonCommand(text: string): string | null {
  const t = text.trim();
  const m =
    t.match(/^about\s+(.+)$/i) ??
    t.match(/^what do you know about\s+(.+)$/i) ??
    t.match(/^what you know about\s+(.+)$/i);
  if (!m?.[1]) return null;
  const name = m[1].replace(/[?.!]+$/g, "").trim();
  if (!name || /^(me|myself|my memory)$/i.test(name)) return null;
  return name.slice(0, 120);
}

export function isDeleteMenuCommand(text: string): boolean {
  const t = normalizeCommandText(text);
  return t === "delete" || t === "remove" || t === "forget";
}

/**
 * forget <label> → whole node
 * forget <label> <attr> → one attr (e.g. forget Rajeev email)
 */
export function parseForgetCommand(
  text: string,
): { label: string; attr?: string } | null {
  const m = text.trim().match(/^(?:forget|delete memory|remove memory)\s+(.+)$/i);
  if (!m?.[1]) return null;
  const rest = m[1].replace(/[?.!]+$/g, "").trim();
  if (!rest || /^(pending|all|memory|me)$/i.test(rest)) return null;
  const parts = rest.split(/\s+/);
  if (parts.length >= 2) {
    const attr = parts[parts.length - 1]!;
    const label = parts.slice(0, -1).join(" ");
    // Treat last token as attr only if it looks like a field key (no spaces, short).
    if (/^[a-z_][a-z0-9_]{1,30}$/i.test(attr) && !/^(jr|sr|ii|iii)$/i.test(attr)) {
      return { label: label.slice(0, 120), attr: attr.toLowerCase() };
    }
  }
  return { label: rest.slice(0, 120) };
}

/**
 * Schedule overview for today/tomorrow — deterministic, bypasses the brain.
 * Avoids "is X scheduled tomorrow?" style questions (those stay with the brain).
 */
export function parseScheduleDayQuery(text: string): "today" | "tomorrow" | null {
  const t = normalizeCommandText(text);
  const wantsTomorrow = /\btomorrow\b/.test(t);
  const wantsToday = /\btoday\b/.test(t);
  if (wantsTomorrow === wantsToday) return null; // neither or both

  // "scheduled" without asking for the schedule itself → leave to brain
  if (/\bscheduled\b/.test(t) && !/\b(my\s+)?(schedule|calendar|agenda|plan)\b/.test(t)) {
    return null;
  }

  const scheduleish =
    /\b(schedule|calendar|agenda|plan)\b/.test(t) ||
    /\b(what'?s|whats|what is|how'?s|hows|how is)\s+on\b/.test(t) ||
    /\banything\s+(on|up)\b/.test(t) ||
    /\bwhat'?s\s+(up|happening)\b/.test(t) ||
    /\b(what'?s|whats|what is|how'?s|hows|how is)\s+(my\s+)?(day|week)\b/.test(t);

  if (!scheduleish) return null;
  return wantsTomorrow ? "tomorrow" : "today";
}

/** waiting on <person> for <thing> */
export function parseWaitingOnCommand(
  text: string,
): { person: string; thing: string } | null {
  const m = text
    .trim()
    .match(/^waiting on\s+(.+?)\s+for\s+(.+)$/i);
  if (!m?.[1] || !m[2]) return null;
  const person = m[1].replace(/[?.!]+$/g, "").trim();
  const thing = m[2].replace(/[?.!]+$/g, "").trim();
  if (person.length < 2 || thing.length < 2) return null;
  return { person: person.slice(0, 80), thing: thing.slice(0, 200) };
}

/** cancel watch <hint> */
export function parseCancelWatchCommand(text: string): string | null {
  const m = text.trim().match(/^cancel watch(?:es)?\s+(.+)$/i);
  if (!m?.[1]) return null;
  const hint = m[1].replace(/[?.!]+$/g, "").trim();
  return hint ? hint.slice(0, 120) : null;
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

/** done / drop / snooze open commitments */
export function parseCommitmentCloseCommand(
  text: string,
): { status: "done" | "dropped" | "snoozed"; titleHint: string; snoozeRaw?: string } | null {
  const t = text.trim();
  const done = t.match(/^(?:done|mark done|finish(?:ed)?|complete(?:d)?)\s+(.+)$/i);
  if (done?.[1]) {
    return {
      status: "done",
      titleHint: done[1].replace(/^(on|the|my)\s+/i, "").trim(),
    };
  }
  const drop = t.match(/^(?:drop|dismiss|cancel reminder)\s+(.+)$/i);
  if (drop?.[1]) {
    return {
      status: "dropped",
      titleHint: drop[1].replace(/^(the|my)\s+/i, "").trim(),
    };
  }
  const snooze = t.match(/^snooze\s+(.+?)\s+(?:to|until)\s+(.+)$/i);
  if (snooze?.[1] && snooze[2]) {
    return {
      status: "snoozed",
      titleHint: snooze[1].replace(/^(the|my)\s+/i, "").trim(),
      snoozeRaw: snooze[2].trim(),
    };
  }
  const mark = t.match(/^mark\s+(.+?)\s+done$/i);
  if (mark?.[1]) {
    return { status: "done", titleHint: mark[1].trim() };
  }
  return null;
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
  "• about <name> — what I know about one person",
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
  "• waiting on <person> for <thing> — watch for their reply",
  "• cancel watch <hint> — drop an open watch",
  "• schedules (memory): “school pickup 4–4:30 daily” · extend till 5 · cancel hold",
  "",
  "Travel",
  "• home is <address> / office is <address>",
  "• places — list saved places",
  "• I'm at home|office — fix leave-by origin",
  "",
  "Writes (always confirm)",
  "• Talk normally to book / invite / cancel calendar",
  "• yes — confirm · cancel — drop · edit <change>",
  "",
  "Delete / forget",
  "• delete — what you can remove",
  "• delete pending — drop open proposal",
  "• forget <name> — remove a remembered person/fact",
  "• forget <name> <attr> — e.g. forget Rajeev email",
  "• clear memory yes — wipe learned context",
  "",
  "Commitments",
  "• done <title> / drop <title> — close an open item",
  "• done 1 / done 2 / done 3 — close a brief priority (until new mail)",
  "• snooze <title> to tomorrow — push due date",
  "",
  "Voice notes work like text. Everything else: just talk.",
].join("\n");

export const HOW_IT_WORKS = [
  "How Amilo works",
  "",
  "1) I sync Gmail + Calendar when you connect Google.",
  "2) Briefs surface only mail that needs action — not every alert.",
  "3) I remember durable facts quietly (people, roles, prefs).",
  "4) Ask about me / about <name> anytime to inspect what I've stored.",
  "5) waiting on <person> for <thing> arms a CoS watch for their reply.",
  "6) With places set, I compute leave-by times and warn on impossible back-to-backs.",
  "7) Calendar/email writes need your yes first — I never invent a write.",
  "8) pause stops me; your data stays until you delete/forget.",
  "",
  "Send help for the command list.",
].join("\n");

export const DELETE_MENU = [
  "What you can remove:",
  "• delete pending — drop the open yes/cancel proposal",
  "• forget <name> — e.g. forget Rajeev",
  "• forget <name> <attr> — e.g. forget Rajeev email",
  "• cancel watch <hint> — drop an open reply/stall watch",
  "• clear memory yes — wipe learned context (people/facts)",
  "• disconnect google <label|all> — unlink Google",
  "",
  "Reminders: say done on that reminder, or cancel when proposed.",
].join("\n");
