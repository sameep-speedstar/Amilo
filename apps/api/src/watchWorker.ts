import {
  buildAwaitingReplyAlert,
  buildCommitmentStallAlert,
  isCommitmentStallDue,
  isInQuietHours,
  underWatcherDailyCap,
  type ChannelPort,
} from "@amilo/core";
import {
  cancelWatch,
  countWatcherAlertsToday,
  findInboundMailAfter,
  fireWatch,
  getCommitmentById,
  getUserPrefs,
  listOpenWatchesWithUsers,
  logMessage,
  markWatchChecked,
  resolvePersonEmail,
  watches,
  type Db,
} from "@amilo/db";
import { commitments } from "@amilo/db";
import { eq } from "drizzle-orm";
import type { GoogleOAuthConfig } from "@amilo/google";
import { scanInboundConflictsForAllUsers } from "./calendarConflictScan.js";
import {
  markWorkerTickError,
  markWorkerTickOk,
  markWorkerTickStart,
  registerWorker,
} from "./workerStatus.js";

const WATCHER_INTERVAL_MS = 120_000;

/**
 * CoS watchers: awaiting_reply, commitment_stall, + inbound calendar conflicts.
 * Caps at 2 pushes/user/day; respects quiet hours.
 */
export function startWatchWorker(opts: {
  db: Db;
  channel: ChannelPort;
  alertTemplate: string;
  languageCode?: string;
  intervalMs?: number;
  googleCfg?: GoogleOAuthConfig | null;
}): { stop: () => void } {
  const intervalMs = opts.intervalMs ?? WATCHER_INTERVAL_MS;
  let running = false;
  registerWorker("watch", intervalMs);

  const sendAlert = async (
    userId: string,
    userName: string | null,
    watchId: string,
    watchKind: string,
    body: string,
  ): Promise<boolean> => {
    const name = userName?.split(/\s+/)[0] || "there";
    try {
      const waMessageId = await opts.channel.send(userId, { text: body });
      await logMessage(opts.db, {
        userId,
        channel: "whatsapp",
        direction: "out",
        kind: "text",
        bodyRef: body.slice(0, 500),
        meta: {
          watchId,
          watchKind,
          ...(waMessageId ? { waMessageId } : {}),
        },
      });
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/Outside 24h|24h window/i.test(msg) && opts.alertTemplate) {
        const param = body.replace(/\n/g, " ").replace(/\s{2,}/g, " ").slice(0, 900);
        const waMessageId = await opts.channel.send(userId, {
          templateName: opts.alertTemplate,
          languageCode: opts.languageCode ?? "en",
          variables: [name, param],
        });
        await logMessage(opts.db, {
          userId,
          channel: "whatsapp",
          direction: "out",
          kind: "template",
          bodyRef: param.slice(0, 500),
          meta: {
            watchId,
            watchKind,
            via: "template",
            template: opts.alertTemplate,
            ...(waMessageId ? { waMessageId } : {}),
          },
        });
        return true;
      }
      console.error(JSON.stringify({ event: "watch_send_error", id: watchId, error: msg }));
      return false;
    }
  };

  const tick = async () => {
    if (running) return;
    running = true;
    markWorkerTickStart("watch");
    try {
      // Inbound invite overlaps (live Google) — before armed watches.
      await scanInboundConflictsForAllUsers({
        db: opts.db,
        googleCfg: opts.googleCfg ?? null,
        channel: opts.channel,
        alertTemplate: opts.alertTemplate,
        ...(opts.languageCode ? { languageCode: opts.languageCode } : {}),
      });

      const open = await listOpenWatchesWithUsers(opts.db);
      const now = new Date();
      for (const w of open) {
        if (w.userStatus === "paused" || w.userStatus === "deleted") {
          await cancelWatch(opts.db, w.id);
          continue;
        }
        await markWatchChecked(opts.db, w.id, now);

        const prefs = await getUserPrefs(opts.db, w.userId);
        if (isInQuietHours(now, w.timezone, prefs.quietStartHm, prefs.quietEndHm)) {
          continue;
        }
        const sentToday = await countWatcherAlertsToday(opts.db, w.userId, now);
        if (!underWatcherDailyCap(sentToday)) continue;

        let body: string | null = null;

        if (w.kind === "awaiting_reply") {
          let email = w.email?.trim().toLowerCase() || null;
          if (!email && w.personLabel) {
            const resolved = await resolvePersonEmail(opts.db, w.userId, w.personLabel);
            if (resolved?.email) {
              email = resolved.email.trim().toLowerCase();
              await opts.db
                .update(watches)
                .set({ email })
                .where(eq(watches.id, w.id));
            }
          }
          if (email) {
            const mail = await findInboundMailAfter(opts.db, {
              userId: w.userId,
              email,
              after: w.armedAt,
            });
            if (mail[0]) {
              body = buildAwaitingReplyAlert({
                personLabel: w.personLabel ?? email,
                mailTitle: mail[0].title,
              });
            }
          }
        }

        if (!body && (w.kind === "commitment_stall" || (w.kind === "awaiting_reply" && w.dueAt))) {
          let due = w.dueAt;
          if (!due && w.commitmentId) {
            due = (await getCommitmentById(opts.db, w.commitmentId))?.dueAt ?? null;
          }
          if (isCommitmentStallDue(due, now)) {
            body = buildCommitmentStallAlert({
              title: w.title,
              personLabel: w.personLabel,
            });
          }
        }

        if (!body) continue;
        const ok = await sendAlert(w.userId, w.userName, w.id, w.kind, body);
        if (!ok) continue;

        await fireWatch(opts.db, w.id, now);
        if (w.commitmentId) {
          const c = await getCommitmentById(opts.db, w.commitmentId);
          if (c?.reason === "reminder") {
            await opts.db
              .update(commitments)
              .set({ notifiedAt: now, status: "done", resolvedAt: now })
              .where(eq(commitments.id, w.commitmentId));
          } else {
            await opts.db
              .update(commitments)
              .set({ notifiedAt: now })
              .where(eq(commitments.id, w.commitmentId));
          }
        }
        console.log(
          JSON.stringify({
            event: "watch_alert_sent",
            id: w.id,
            userId: w.userId,
            kind: w.kind,
          }),
        );
      }
      markWorkerTickOk("watch");
    } catch (err) {
      markWorkerTickError("watch", err instanceof Error ? err.message : String(err));
      console.error(
        JSON.stringify({
          event: "watch_tick_error",
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
