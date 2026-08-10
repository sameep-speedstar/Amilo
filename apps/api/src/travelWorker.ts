import {
  ALERT_LEAD_MINS,
  buildDepartureAlertText,
  isInQuietHours,
  localDayBoundsUtc,
  type ChannelPort,
} from "@amilo/core";
import {
  events,
  getUserById,
  getUserPrefs,
  listTravelPlansForRecheck,
  listTravelPlansNeedingAlert,
  logMessage,
  markTravelAlertSent,
  users,
  type Db,
} from "@amilo/db";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { MapsClient, buildMapsDeepLink } from "@amilo/google";
import {
  computeTravelPlanForBlock,
  eventToTravelBlock,
  recheckTravelPlan,
} from "./travelService.js";

/**
 * Travel intelligence worker: compute leave-by plans, departure alerts, T-30/T-10 rechecks.
 */
export function startTravelWorker(opts: {
  db: Db;
  channel: ChannelPort;
  mapsApiKey: string | null;
  alertTemplate: string;
  languageCode?: string;
  intervalMs?: number;
}): { stop: () => void } {
  const intervalMs = opts.intervalMs ?? 60_000;
  let running = false;
  const maps = opts.mapsApiKey ? new MapsClient(opts.mapsApiKey) : null;

  const tick = async () => {
    if (running || !maps) return;
    running = true;
    try {
      await computePlansForActiveUsers(opts.db, maps);
      await sendDepartureAlerts({ ...opts, maps });
      await runRechecks(opts.db, maps, opts.channel);
    } catch (err) {
      console.error(
        JSON.stringify({
          event: "travel_tick_error",
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
  return { stop: () => clearInterval(handle) };
}

async function computePlansForActiveUsers(db: Db, maps: MapsClient): Promise<void> {
  const activeUsers = await db
    .select({ id: users.id, timezone: users.timezone, prefs: users.prefs })
    .from(users)
    .where(eq(users.status, "active"))
    .limit(40);

  for (const u of activeUsers) {
    const prefs = {
      ...(u.prefs ?? {}),
      ...(await getUserPrefs(db, u.id)),
    } as Record<string, unknown>;
    const { timeMin, timeMax } = localDayBoundsUtc(u.timezone);
    const lookMax = new Date(timeMax.getTime() + 2 * 86_400_000);
    const calRows = await db.query.events.findMany({
      where: and(
        eq(events.userId, u.id),
        eq(events.source, "calendar"),
        gte(events.occursAt, timeMin),
        lte(events.occursAt, lookMax),
      ),
      orderBy: [asc(events.occursAt)],
      limit: 40,
    });

    const blocks = calRows
      .map((e) => eventToTravelBlock(e, u.timezone))
      .filter((b): b is NonNullable<typeof b> => Boolean(b));

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i]!;
      try {
        await computeTravelPlanForBlock(db, maps, {
          userId: u.id,
          timeZone: u.timezone,
          prefs,
          block,
          preceding: blocks.slice(0, i),
        });
      } catch (err) {
        console.error(
          JSON.stringify({
            event: "travel_plan_compute_error",
            userId: u.id,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    }
  }
}

async function sendDepartureAlerts(opts: {
  db: Db;
  channel: ChannelPort;
  maps: MapsClient;
  alertTemplate: string;
  languageCode?: string;
}): Promise<void> {
  const plans = await listTravelPlansNeedingAlert(opts.db, {
    leadMins: ALERT_LEAD_MINS,
  });
  for (const plan of plans) {
    const user = await getUserById(opts.db, plan.userId);
    if (!user || user.status === "paused") {
      await markTravelAlertSent(opts.db, plan.id);
      continue;
    }
    const prefs = await getUserPrefs(opts.db, plan.userId);
    if (isInQuietHours(new Date(), user.timezone, prefs.quietStartHm, prefs.quietEndHm)) {
      continue;
    }
    if (
      plan.destinationLat == null ||
      plan.destinationLng == null ||
      plan.leaveBy == null ||
      plan.travelMins == null
    ) {
      await markTravelAlertSent(opts.db, plan.id);
      continue;
    }
    const deepLink = buildMapsDeepLink(plan.destinationLat, plan.destinationLng);
    const body = buildDepartureAlertText({
      title: plan.itemTitle ?? "Event",
      travelMins: plan.travelMins,
      leaveBy: plan.leaveBy,
      originLabel: plan.originLabel,
      destLat: plan.destinationLat,
      destLng: plan.destinationLng,
      timeZone: user.timezone,
      escalate: Boolean(plan.escalated),
      deepLink,
    });
    const name = user.name?.split(/\s+/)[0] || "there";
    try {
      const waMessageId = await opts.channel.send(plan.userId, { text: body });
      await logMessage(opts.db, {
        userId: plan.userId,
        channel: "whatsapp",
        direction: "out",
        kind: "text",
        bodyRef: body.slice(0, 500),
        meta: { travelPlanId: plan.id, ...(waMessageId ? { waMessageId } : {}) },
      });
      await markTravelAlertSent(opts.db, plan.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/Outside 24h|24h window/i.test(msg) && opts.alertTemplate) {
        const param = body.replace(/\n/g, " ").replace(/\s{2,}/g, " ").slice(0, 900);
        await opts.channel.send(plan.userId, {
          templateName: opts.alertTemplate,
          languageCode: opts.languageCode ?? "en",
          variables: [name, param],
        });
        await markTravelAlertSent(opts.db, plan.id);
      } else {
        console.error(
          JSON.stringify({
            event: "travel_alert_send_error",
            id: plan.id,
            error: msg,
          }),
        );
      }
    }
  }
}

async function runRechecks(db: Db, maps: MapsClient, channel: ChannelPort): Promise<void> {
  const due = await listTravelPlansForRecheck(db);
  for (const plan of due) {
    const user = await getUserById(db, plan.userId);
    if (!user || user.status === "paused") continue;
    const prefsRow = await getUserById(db, plan.userId);
    const prefs = {
      ...(prefsRow?.prefs ?? {}),
      ...(await getUserPrefs(db, plan.userId)),
    } as Record<string, unknown>;
    try {
      const result = await recheckTravelPlan(db, maps, plan, plan.stage, prefs);
      if (
        result?.degraded &&
        result.plan.destinationLat != null &&
        result.plan.destinationLng != null &&
        result.plan.leaveBy &&
        result.plan.travelMins != null
      ) {
        const deepLink = buildMapsDeepLink(
          result.plan.destinationLat,
          result.plan.destinationLng,
        );
        const body = buildDepartureAlertText({
          title: result.plan.itemTitle ?? "Event",
          travelMins: result.plan.travelMins,
          leaveBy: result.plan.leaveBy,
          originLabel: result.plan.originLabel,
          destLat: result.plan.destinationLat,
          destLng: result.plan.destinationLng,
          timeZone: user.timezone,
          escalate: true,
          deepLink,
        });
        try {
          await channel.send(plan.userId, { text: body });
          await logMessage(db, {
            userId: plan.userId,
            channel: "whatsapp",
            direction: "out",
            kind: "text",
            bodyRef: body.slice(0, 500),
            meta: { travelPlanId: plan.id, escalate: true },
          });
        } catch {
          /* quiet / window — next tick may use template via alert path */
        }
      }
    } catch (err) {
      console.error(
        JSON.stringify({
          event: "travel_recheck_error",
          id: plan.id,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }
}
