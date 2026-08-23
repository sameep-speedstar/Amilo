import { formatLocalHm, localDayBoundsUtc, type ChannelPort } from "@amilo/core";
import {
  listDueReminders,
  listPostBriefReminders,
  listUsersForScheduledBriefs,
  logMessage,
  markReminderNotified,
  type Db,
} from "@amilo/db";
import {
  markWorkerTickError,
  markWorkerTickOk,
  markWorkerTickStart,
  registerWorker,
} from "./workerStatus.js";

/**
 * Poll due reminders and push WhatsApp pings.
 * Free-form inside 24h window; falls back to priority_update template outside.
 */
export function startReminderWorker(opts: {
  db: Db;
  channel: ChannelPort;
  alertTemplate: string;
  languageCode?: string;
  intervalMs?: number;
}): { stop: () => void } {
  const intervalMs = opts.intervalMs ?? 30_000;
  let running = false;
  registerWorker("reminder", intervalMs);

  const tick = async () => {
    if (running) return;
    running = true;
    markWorkerTickStart("reminder");
    try {
      const due = await listDueReminders(opts.db);
      for (const r of due) {
        if (r.status === "paused" || r.status === "deleted") {
          await markReminderNotified(opts.db, r.id);
          continue;
        }
        const when = formatLocalHm(r.dueAt, r.timezone);
        const body = `Reminder (${when}): ${r.title}`;
        const name = r.userName?.split(/\s+/)[0] || "there";
        try {
          const waMessageId = await opts.channel.send(r.userId, { text: body });
          await logMessage(opts.db, {
            userId: r.userId,
            channel: "whatsapp",
            direction: "out",
            kind: "text",
            bodyRef: body.slice(0, 500),
            meta: {
              reminderId: r.id,
              ...(waMessageId ? { waMessageId } : {}),
            },
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (/Outside 24h|24h window/i.test(msg) && opts.alertTemplate) {
            const param = body.replace(/\n/g, " ").replace(/\s{2,}/g, " ").slice(0, 900);
            const waMessageId = await opts.channel.send(r.userId, {
              templateName: opts.alertTemplate,
              languageCode: opts.languageCode ?? "en",
              variables: [name, param],
            });
            await logMessage(opts.db, {
              userId: r.userId,
              channel: "whatsapp",
              direction: "out",
              kind: "template",
              bodyRef: param.slice(0, 500),
              meta: {
                reminderId: r.id,
                via: "template",
                template: opts.alertTemplate,
                ...(waMessageId ? { waMessageId } : {}),
              },
            });
          } else {
            console.error(
              JSON.stringify({
                event: "reminder_send_error",
                id: r.id,
                error: msg,
              }),
            );
            continue;
          }
        }
        await markReminderNotified(opts.db, r.id);
        console.log(
          JSON.stringify({
            event: "reminder_sent",
            id: r.id,
            userId: r.userId,
            title: r.title,
          }),
        );
      }

      const users = await listUsersForScheduledBriefs(opts.db);
      const now = new Date();
      for (const u of users) {
        const tz = u.timezone || "Asia/Kolkata";
        const bounds = localDayBoundsUtc(tz, now);
        if (u.prefs.lastMorningBriefDay !== bounds.day) continue;
        const extras = await listPostBriefReminders(opts.db, u.id, bounds);
        for (const rem of extras) {
          const body = `Reminder: ${rem.title}`;
          try {
            const waMessageId = await opts.channel.send(u.id, { text: body });
            await logMessage(opts.db, {
              userId: u.id,
              channel: "whatsapp",
              direction: "out",
              kind: "text",
              bodyRef: body.slice(0, 500),
              meta: {
                reminderId: rem.id,
                afterBrief: true,
                ...(waMessageId ? { waMessageId } : {}),
              },
            });
            await markReminderNotified(opts.db, rem.id);
          } catch (err) {
            console.error(
              JSON.stringify({
                event: "post_brief_reminder_retry_error",
                id: rem.id,
                error: err instanceof Error ? err.message : String(err),
              }),
            );
          }
        }
      }
      markWorkerTickOk("reminder");
    } catch (err) {
      markWorkerTickError("reminder", err instanceof Error ? err.message : String(err));
      console.error(
        JSON.stringify({
          event: "reminder_tick_error",
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
