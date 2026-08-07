import {
  flattenWaTemplateParam,
  formatLocalDateLong,
  isHmInWindow,
  localDayBoundsUtc,
  localHm,
  type ChannelPort,
} from "@amilo/core";
import {
  buildPriorityBriefPayload,
  getUserPrefs,
  listUsersForScheduledBriefs,
  logEvalEvent,
  logMessage,
  patchUserPrefs,
  type Db,
} from "@amilo/db";
import type { GoogleOAuthConfig } from "@amilo/google";
import { syncGoogleForUser } from "./googleSync.js";

/**
 * Poll local morning/evening slots and push WABA templates.
 * Always templates (works outside 24h). Idempotent per local calendar day.
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
        const brief = await buildPriorityBriefPayload(
          opts.db,
          u.id,
          tz,
          prefs.mutedPatterns,
          prefs.vipList,
        );
        const bodyFlat = flattenWaTemplateParam(brief.digestFlat, 900);

        if (dueMorning) {
          const dateLong = flattenWaTemplateParam(formatLocalDateLong(now, tz), 80);
          try {
            const waMessageId = await opts.channel.send(u.id, {
              templateName: opts.morningTemplate,
              languageCode: lang,
              variables: [
                flattenWaTemplateParam(name, 60),
                dateLong,
                bodyFlat,
              ],
            });
            await patchUserPrefs(opts.db, u.id, {
              lastMorningBriefDay: day,
              lastBriefItems: brief.items,
              lastBriefMore: brief.moreText,
            });
            await logMessage(opts.db, {
              userId: u.id,
              channel: "whatsapp",
              direction: "out",
              kind: "template",
              bodyRef: `Morning brief · ${bodyFlat}`.slice(0, 500),
              meta: {
                scheduled: "morning",
                day,
                template: opts.morningTemplate,
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
                priorities: brief.items.length,
              }),
            );
            await logEvalEvent(opts.db, {
              userId: u.id,
              event: "brief_sent",
              note: "morning",
              meta: { day, priorities: brief.items.length },
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
          try {
            const waMessageId = await opts.channel.send(u.id, {
              templateName: opts.eveningTemplate,
              languageCode: lang,
              variables: [flattenWaTemplateParam(name, 60), bodyFlat],
            });
            await patchUserPrefs(opts.db, u.id, {
              lastEveningBriefDay: day,
              lastBriefItems: brief.items,
              lastBriefMore: brief.moreText,
            });
            await logMessage(opts.db, {
              userId: u.id,
              channel: "whatsapp",
              direction: "out",
              kind: "template",
              bodyRef: `Evening wrap · ${bodyFlat}`.slice(0, 500),
              meta: {
                scheduled: "evening",
                day,
                template: opts.eveningTemplate,
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
                priorities: brief.items.length,
              }),
            );
            await logEvalEvent(opts.db, {
              userId: u.id,
              event: "brief_sent",
              note: "evening",
              meta: { day, priorities: brief.items.length },
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
