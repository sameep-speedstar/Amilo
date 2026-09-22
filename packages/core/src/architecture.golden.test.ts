/**
 * Golden regressions for the domain-lock architecture
 * (Sameep / Nisha / Rajeev miss classes).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  accountHasGmailSend,
  emailDraftNeedsRewrite,
  pickGmailSendAccount,
  polishEmailDraftPayload,
  rewriteSpokenEmailDirections,
} from "./emailDraft.js";
import {
  canScriptVendorHandoff,
  classifyOptionListKind,
  classifyVendorHandoffKind,
  coerceOptionPick,
  isVendorBookOrReserveAsk,
  looksLikeCalendarBookingAsk,
  looksLikeMovieTicketAsk,
  mergeLifeOpsIntoCalendarText,
  shouldInheritLifeOpsCalendarContext,
  optionPickSource,
  preferLifeOpsNumberPick,
  resolveActiveDomain,
  resolveListedOptionVenue,
  sanitizeLifeOpsReplyText,
  vendorBookingUnavailableReply,
} from "./lifeOps.js";

describe("architecture golden — domain lock + Grok unlock", () => {
  it("1 domain-lock: quote / latest list / lexical / unlocked", () => {
    const chat = [
      "User: dinner near Sector 35",
      "Amilo: A) Katani Dhaba — Punjabi",
      "User: flights to Goa",
      "Amilo: Goa flights:\nA) IndiGo 06:15 — ₹4200\nB) Air India 09:40\nReply with a letter to pick.",
    ].join("\n");
    assert.equal(resolveActiveDomain({ text: "A", recentChat: chat }), "travel");
    assert.equal(
      resolveActiveDomain({
        text: "A",
        recentChat: chat,
        replyToContent: "A) Katani Dhaba — Punjabi",
      }),
      "dining",
    );
    assert.equal(
      resolveActiveDomain({
        text: "A",
        recentChat: chat,
        openPending: {
          kind: "life_ops_research",
          payload: { vendorKind: "movie", findings: "A) PVR — 7pm" },
        },
      }),
      "movie",
    );
    assert.equal(resolveActiveDomain({ text: "Book Burma Burma" }), null);
  });

  it("2 grok-first: Mirzapur tickets never script dining; bare book unlocked", () => {
    const mirzapur = "Book two tickets for Mirzapur today in Ilante Chandigarh Mall";
    assert.equal(looksLikeMovieTicketAsk(mirzapur), true);
    assert.equal(classifyVendorHandoffKind(mirzapur), "movie");
    assert.equal(resolveActiveDomain({ text: mirzapur }), "movie");
    assert.equal(canScriptVendorHandoff("movie", "dining", mirzapur), false);
    assert.equal(canScriptVendorHandoff(null, "other", "Book Burma Burma"), false);
    assert.equal(
      canScriptVendorHandoff("dining", "dining", "Book Katani Dhaba Fri 8pm table for 3"),
      true,
    );
    assert.equal(canScriptVendorHandoff("cab", "cab", "Book Uber, flight is at 11 PM"), true);
  });

  it("2b book/reserve: limitation copy, not pay-link handoff", () => {
    assert.equal(isVendorBookOrReserveAsk("Book Katani Dhaba Fri 8pm table for 3"), true);
    assert.equal(looksLikeCalendarBookingAsk("Cool, book 1 hour with Rajeev at 1pm"), true);
    const copy = vendorBookingUnavailableReply({ vendorKind: "dining", venueHint: "Katani" });
    assert.match(copy, /can't book or reserve/i);
    assert.match(copy, /find/i);
  });

  it("2c context lock: a new plan does not inherit the last Book links venue", () => {
    const chat = [
      "User: Book two tickets for Mirzapur today in Ilante Chandigarh Mall",
      "Amilo: Book links: two tickets for Mirzapur · today in Ilante Chandigarh Mall",
      "User: table for 2 near Indiranagar tomorrow 8pm",
      "Amilo: Handoff (reservation): Burma Burma",
    ].join("\n");
    const serious =
      "Send mail to sameep and block his calendar for today 4pm for discussing on seriousprep";
    assert.equal(shouldInheritLifeOpsCalendarContext(serious), false);
    assert.equal(mergeLifeOpsIntoCalendarText(serious, chat), serious);
    assert.equal(
      shouldInheritLifeOpsCalendarContext("block calendar and send invite to Mahesh"),
      true,
    );
    assert.match(
      mergeLifeOpsIntoCalendarText("block calendar and send invite to Mahesh", chat),
      /Burma Burma/,
    );
  });

  it("3 post-grok: scrub fake ET / identical clocks; no Zomato-shaped movie invent", () => {
    const fake =
      "PVR Vega: https://in.bookmyshow.com/buytickets/x/movie-bang-ET003XXXX/show-ET003XXXX-20260921-2000";
    const scrubbed = sanitizeLifeOpsReplyText(fake, {
      recentChat: "https://in.bookmyshow.com/movies/bengaluru/mirzapur-the-movie/ET00417686",
    });
    assert.doesNotMatch(scrubbed, /ET003XXXX/);
    assert.match(scrubbed, /ET00417686/);

    const invent =
      "Mirzapur (today 8 PM)\nA) INOX Elante — 8:00 PM show.\nB) PVR Centra — 8:00 PM show.\nC) INOX Chandigarh — 8:00 PM show.";
    const cleaned = sanitizeLifeOpsReplyText(invent);
    assert.doesNotMatch(cleaned, /A\) INOX Elante — 8:00 PM/);
    assert.match(cleaned, /check live showtimes|couldn't confirm identical clocks/i);
  });

  it("4 email: rewrite STT directions; pick send-capable Gmail over personal readonly", () => {
    const voice =
      "Draft another email for Sameep. In this email, I'm just checking if the random words that I'm saying is getting drafted by Amilo to sound professional. And also this email has to sound very professional saying that Amilo is doing a great job, all the best.";
    const rewritten = rewriteSpokenEmailDirections({
      sourceText: voice,
      toHint: "Sameep",
      userName: "Nisha",
    });
    assert.doesNotMatch(rewritten.body, /random words|sound professional|i'm just checking/i);
    assert.match(rewritten.body, /great job/i);
    assert.match(rewritten.body, /^Hi Sameep,/);

    const dump = {
      to: "sameep@speedstar.ai",
      subject: "I'm saying is getting drafted by Amilo to sound professional. And also",
      body: "Hi Sameep.,\n\nI'm saying is getting drafted by Amilo to sound professional. And also this email has to sound very professional saying that Amilo is doing a great job, all the best.\n\nNisha",
      recipientLabel: "Sameep",
    };
    assert.equal(emailDraftNeedsRewrite(dump, voice), true);
    const polished = polishEmailDraftPayload(dump, { sourceText: voice, userName: "Nisha" });
    assert.equal(emailDraftNeedsRewrite(polished, voice), false);
    assert.doesNotMatch(String(polished.body), /random words/i);

    const accounts = [
      {
        label: "personal",
        email: "rajeev@gmail.com",
        scopes: "https://www.googleapis.com/auth/gmail.readonly",
      },
      {
        label: "speedstar",
        email: "speedstarai8@gmail.com",
        scopes:
          "https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/calendar.events",
      },
    ];
    assert.equal(accountHasGmailSend(accounts[0]!.scopes), false);
    assert.equal(accountHasGmailSend(accounts[1]!.scopes), true);
    assert.equal(pickGmailSendAccount(accounts, "personal")?.label, "speedstar");
    assert.equal(pickGmailSendAccount(accounts)?.label, "speedstar");
    assert.equal(pickGmailSendAccount([accounts[0]!]), null);
  });

  it("5 options: Goa A binds latest flights; dinner quote wins; digit coerce", () => {
    const chat = [
      "User: dinner",
      "Amilo: A) Katani Dhaba — Punjabi B) Peddlers",
      "User: flights to Goa",
      "Amilo: Goa flights:\nA) IndiGo 06:15 DEL→GOI — ₹4200\nB) Air India 09:40\nReply with a letter to pick.",
    ].join("\n");
    const latest = optionPickSource({ recentChat: chat });
    assert.equal(classifyOptionListKind(latest), "travel");
    assert.match(resolveListedOptionVenue(latest, "A") ?? "", /IndiGo 06:15/);
    assert.equal(preferLifeOpsNumberPick({ text: "A", recentChat: chat }), true);
    assert.equal(coerceOptionPick("1", latest), "A");

    const quoted = optionPickSource({
      recentChat: chat,
      replyToContent: "A) Katani Dhaba — Punjabi B) Peddlers",
    });
    assert.equal(classifyOptionListKind(quoted), "dining");
    assert.equal(resolveListedOptionVenue(quoted, "A"), "Katani Dhaba");
  });
});
