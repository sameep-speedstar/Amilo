import {
  flattenWaTemplateParam,
  formatLocalDateLong,
  isHmInWindow,
  localDayBoundsUtc,
  localHm,
  type ChannelPort,
} from "@amilo/core";
import { isInside24hWindow } from "@amilo/channels-whatsapp";
import {
  buildPriorityBriefPayload,
  getUserPrefs,
  getWhatsAppAddress,
  getWhatsAppLastInbound,
  listUsersForScheduledBriefs,
  logEvalEvent,
  logMessage,
  patchUserPrefs,
  type Db,
} from "@amilo/db";
import type { GoogleOAuthConfig } from "@amilo/google";
import { syncGoogleForUser } from "./googleSync.js";

/**
 * Poll local morning/evening slots and push briefs.
 * Prefer free-form bullets inside the 24h window; WABA templates outside it.
 */
export function startBriefWorker(opts: {
  db: Db;
  channel: ChannelPort;
  googleCfg: GoogleOAuthConfig | null;
  morningTemplate: string;
  eveningTemplate: string;
  languageCode?: string;
  intervalMs?: number;
  fireWindowMinutes?: number;
}): { stop: () => void } {
  const intervalMs = opts.intervalMs ?? 60_000;
  const fireWindow = opts.fireWindowMinutes ?? 5;
  const lang = opts.languageCode ?? "en";
  let running = false;

  const tick = async () => {
    if (running) return;
    if (!opts.googleCfg) return;
    running = true;
    const now = new Date();
    try {
      const candidates = await listUsersForScheduledBriefs(opts.db);
      for (const u of candidates) {
        if (!u.prefs.briefsEnabled) continue;
        const tz = u.timezone || "Asia/Kolkata";
        const { day } = localDayBoundsUtc(tz, now);
        const hm = localHm(now, tz);
        const name = (u.name ?? "there").split(/\s+/)[0] || "there";

        const dueMorning =
          isHmInWindow(hm, u.prefs.morningHm, fireWindow) &&
          u.prefs.lastMorningBriefDay !== day;
        const dueEvening =
          isHmInWindow(hm, u.prefs.eveningHm, fireWindow) &&
          u.prefs.lastEveningBriefDay !== day;

        if (!dueMorning && !dueEvening) continue;

        try {
          await syncGoogleForUser(
            opts.db,
            opts.googleCfg,
            u.id,
            tz,
            u.prefs.mutedPatterns,
          );
        } catch (err) {
          console.error(
            JSON.stringify({
              event: "scheduled_brief_sync_error",
              userId: u.id,
              error: err instanceof Error ? err.message : String(err),
            }),
          );
          continue;
        }

        const prefs = await getUserPrefs(opts.db, u.id);
        const waAddr = await getWhatsAppAddress(opts.db, u.id);
        const lastIn = waAddr ? await getWhatsAppLastInbound(opts.db, waAddr) : null;
        const canFreeForm = isInside24hWindow(lastIn, now);

        if (dueMorning) {
          const brief = await buildPriorityBriefPayload(
            opts.db,
            u.id,
            tz,
            prefs.mutedPatterns,
            prefs.vipList,
            {
              kind: "am",
              now,
              closedMailThreads: prefs.closedMailThreads,
              closedMailFingerprints: prefs.closedMailFingerprints,
            },
          );
          try {
            let waMessageId: string | void;
            let bodyRef: string;
            if (canFreeForm) {
              const text = `Morning brief — ${name}\n\n${brief.digestText}`.slice(0, 3500);
              waMessageId = await opts.channel.send(u.id, { text });
              bodyRef = text;
            } else {
              const bodyFlat = flattenWaTemplateParam(brief.digestFlat, 900);
              const dateLong = flattenWaTemplateParam(formatLocalDateLong(now, tz), 80);
              waMessageId = await opts.channel.send(u.id, {
                templateName: opts.morningTemplate,
                languageCode: lang,
                variables: [
                  flattenWaTemplateParam(name, 60),
                  dateLong,
                  bodyFlat,
                ],
              });
              bodyRef = `Morning brief · ${bodyFlat}`;
            }
            await patchUserPrefs(opts.db, u.id, {
              lastMorningBriefDay: day,
              lastBriefItems: brief.items,
              lastBriefMore: brief.moreText,
            });
            await logMessage(opts.db, {
              userId: u.id,
              channel: "whatsapp",
              direction: "out",
              kind: canFreeForm ? "text" : "template",
              bodyRef: bodyRef.slice(0, 500),
              meta: {
                scheduled: "morning",
                day,
                freeForm: canFreeForm,
                template: canFreeForm ? undefined : opts.morningTemplate,
                briefItems: brief.items.map((i) => i.label),
                ...(waMessageId ? { waMessageId } : {}),
              },
            });
            console.log(
              JSON.stringify({
                event: "scheduled_brief_sent",
                kind: "morning",
                userId: u.id,
                day,
                freeForm: canFreeForm,
                priorities: brief.items.length,
              }),
            );
            await logEvalEvent(opts.db, {
              userId: u.id,
              event: "brief_sent",
              note: "morning",
              meta: { day, priorities: brief.items.length, freeForm: canFreeForm },
            });
          } catch (err) {
            console.error(
              JSON.stringify({
                event: "scheduled_brief_send_error",
                kind: "morning",
                userId: u.id,
                error: err instanceof Error ? err.message : String(err),
              }),
            );
          }
        }

        if (dueEvening) {
          const brief = await buildPriorityBriefPayload(
            opts.db,
            u.id,
            tz,
            prefs.mutedPatterns,
            prefs.vipList,
            {
              kind: "pm",
              now,
              closedMailThreads: prefs.closedMailThreads,
              closedMailFingerprints: prefs.closedMailFingerprints,
            },
          );
          try {
            let waMessageId: string | void;
            let bodyRef: string;
            if (canFreeForm) {
              const text = `Evening wrap — ${name}\n\n${brief.digestText}`.slice(0, 3500);
              waMessageId = await opts.channel.send(u.id, { text });
              bodyRef = text;
            } else {
              const bodyFlat = flattenWaTemplateParam(brief.digestFlat, 900);
              waMessageId = await opts.channel.send(u.id, {
                templateName: opts.eveningTemplate,
                languageCode: lang,
                variables: [flattenWaTemplateParam(name, 60), bodyFlat],
              });
              bodyRef = `Evening wrap · ${bodyFlat}`;
            }
            await patchUserPrefs(opts.db, u.id, {
              lastEveningBriefDay: day,
              lastBriefItems: brief.items,
              lastBriefMore: brief.moreText,
            });
            await logMessage(opts.db, {
              userId: u.id,
              channel: "whatsapp",
              direction: "out",
              kind: canFreeForm ? "text" : "template",
              bodyRef: bodyRef.slice(0, 500),
              meta: {
                scheduled: "evening",
                day,
                freeForm: canFreeForm,
                template: canFreeForm ? undefined : opts.eveningTemplate,
                briefItems: brief.items.map((i) => i.label),
                ...(waMessageId ? { waMessageId } : {}),
              },
            });
            console.log(
              JSON.stringify({
                event: "scheduled_brief_sent",
                kind: "evening",
                userId: u.id,
                day,
                freeForm: canFreeForm,
                priorities: brief.items.length,
              }),
            );
            await logEvalEvent(opts.db, {
              userId: u.id,
              event: "brief_sent",
              note: "evening",
              meta: { day, priorities: brief.items.length, freeForm: canFreeForm },
            });
          } catch (err) {
            console.error(
              JSON.stringify({
                event: "scheduled_brief_send_error",
                kind: "evening",
                userId: u.id,
                error: err instanceof Error ? err.message : String(err),
              }),
            );
          }
        }
      }
    } catch (err) {
      console.error(
        JSON.stringify({
          event: "brief_worker_tick_error",
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    } finally {
      running = false;
    }
  };

  const handle = setInterval(() => {
    void tick();
  }, intervalMs);
  void tick();
  return {
    stop: () => clearInterval(handle),
  };
}
