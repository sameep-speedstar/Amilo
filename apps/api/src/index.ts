import { createServer } from "node:http";
import { config as loadEnv } from "dotenv";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { createCursorBrain, createStubBrain } from "@amilo/brain-cursor";
import { classifyBorderlineMail, createGrokBrain } from "@amilo/brain-grok";
import type { BrainPort } from "@amilo/brain-contract";
import {
  createWhatsAppChannel,
  downloadWhatsAppMedia,
  parseWhatsAppWebhook,
  verifyWebhookSignature,
  type WindowStore,
} from "@amilo/channels-whatsapp";
import {
  buildGmailSearchQuery,
  checkSlotConflicts,
  formatConflictProposalNote,
  handleInbound,
  localDayBoundsUtc,
  scheduleBlocksForRange,
  type CalendarBlock,
  type InboundMessage,
  type OrchestratorDeps,
} from "@amilo/core";
import { processVoiceNote } from "./voice/pipeline.js";
import { writeReminderCalendarNudge } from "./calendarNudge.js";
import {
  addMutedPattern,
  applyGraphUpdates,
  buildPriorityBriefPayload,
  closeBriefPriorityItem,
  claimWebhookMessage,
  clearContextGraph,
  createCommitment,
  createDb,
  createPendingAction,
  createReminder,
  createWatch,
  cancelWatchesByHint,
  deleteContextNodeByLabel,
  deleteGoogleAccount,
  findMessageByWaId,
  forgetContextAttr as forgetContextAttrRepo,
  getOpenPendingAction,
  getRecentChatSummary,
  getUserById,
  getUserPrefs,
  linkWaitingOnPerson,
  listPlaces,
  rememberPersonEmail,
  resolveCommitmentByHint,
  resolvePersonEmail,
  getWhatsAppAddress,
  getWhatsAppLastInbound,
  listGoogleAccounts,
  logEvalEvent,
  logMessage,
  findCalendarEventMatches,
  patchUserPrefs,
  removeMutedPattern,
  setCursorAgentId,
  setTimezoneConfirmed,
  setUserStatus,
  setUserTimezone,
  summarizeAboutMe,
  summarizeAboutPerson,
  summarizeCalendarToday,
  summarizeCalendarTomorrow,
  listSyncedCalendarBlocks,
  listScheduleNodes as listScheduleNodesRepo,
  upsertScheduleNode as upsertScheduleNodeRepo,
  clearScheduleHolds as clearScheduleHoldsRepo,
  summarizeContextGraph,
  summarizeOpenCommitments,
  summarizeRecentMail,
  searchMailEvents,
  recentCompleted,
  scrubSeededKnownContacts,
  upsertPlace,
  touchWhatsAppInbound,
  updatePendingPayload,
  isPhoneAllowlisted,
  checkUsageCaps,
  isUsageCapExemptPhone,
  recordUsage,
  USAGE_COST_MICROS,
  claimInvite,
  createInvite,
  createAccessRequest,
  createAdminSession,
  destroyAdminSession,
  getAdminSessionEmail,
  adminPasswordMatches,
  approveAccessRequest,
  decideAccessRequest,
  markAccessRequestActiveByPhone,
  normalizeEmail,
  addAllowedPhone,
  deactivateAllowedPhone,
  getInviteByToken,
  inviteIsOpen,
  waMeUrl,
  upsertGoogleAccount,
  upsertWhatsAppUser,
  upsertEvent,
  type Db,
  type PendingActionKind,
} from "@amilo/db";
import {
  buildAuthUrl,
  decodeState,
  encryptToken,
  exchangeCode,
  fetchEmail,
  listCalendarRange,
  MapsClient,
  searchGmail,
  type GoogleOAuthConfig,
} from "@amilo/google";
import { googleConfigured, loadSettings, resolveBrainLabel } from "./config.js";
import { ensureAccessToken, syncGoogleForUser } from "./googleSync.js";
import { startBriefWorker } from "./briefWorker.js";
import { executePendingAction, rejectPendingAction } from "./pendingExecute.js";
import { startReminderWorker } from "./reminders.js";
import { startTravelWorker } from "./travelWorker.js";
import { startWatchWorker } from "./watchWorker.js";
import { correctTravelOrigin, geocodeAddress } from "./travelService.js";
import {
  adminAuthOk,
  buildQrPngDataUrl,
  clearAdminSessionCookie,
  getAdminSessionToken,
  renderAdminDashboard,
  renderAdminLogin,
  renderInvitePage,
  setAdminCookie,
  setAdminSessionCookie,
} from "./adminUi.js";

loadEnv();

const settings = loadSettings();
const app = new Hono();
const db: Db = createDb(settings.databaseUrl);
const brainLabel = resolveBrainLabel(settings);
const googleOk = googleConfigured(settings);

const googleCfg: GoogleOAuthConfig | null = googleOk
  ? {
      clientId: settings.googleClientId,
      clientSecret: settings.googleClientSecret,
      redirectUri: settings.googleRedirectUri,
      encryptionKey: settings.tokenEncryptionKey,
    }
  : null;

function createBrain(): BrainPort {
  if (settings.xaiApiKey) {
    return createGrokBrain({
      apiKey: settings.xaiApiKey,
      model: settings.grokModel,
    });
  }
  if (settings.cursorApiKey) {
    return createCursorBrain({
      apiKey: settings.cursorApiKey,
      model: settings.cursorModel,
      repoUrl: settings.cursorBrainRepo,
      startingRef: settings.cursorBrainRef,
      agentStore: {
        get: async (userId) => {
          const u = await getUserById(db, userId);
          return u?.cursorAgentId ?? null;
        },
        set: async (userId, id) => {
          await setCursorAgentId(db, userId, id);
        },
      },
    });
  }
  return createStubBrain();
}

const brain = createBrain();

const windows: WindowStore = {
  getLastInbound: (waId) => getWhatsAppLastInbound(db, waId),
  setLastInbound: (waId, at) => touchWhatsAppInbound(db, waId, at),
};

const waChannel = createWhatsAppChannel({
  cfg: {
    accessToken: settings.wabaAccessToken,
    phoneNumberId: settings.wabaPhoneNumberId,
    appSecret: settings.wabaAppSecret,
  },
  windows,
  resolveAddress: async (userId) => {
    const addr = await getWhatsAppAddress(db, userId);
    if (!addr) throw new Error(`no whatsapp channel for user ${userId}`);
    return addr;
  },
});

async function checkUserCalendarConflict(
  userId: string,
  opts: { startIso: string; endIso: string; timezone: string },
): Promise<{
  clear: boolean;
  conflictNote: string | null;
  suggested: { startIso: string; endIso: string } | null;
  conflictTitle: string | null;
}> {
  const start = new Date(opts.startIso);
  const end = new Date(opts.endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { clear: true, conflictNote: null, suggested: null, conflictTitle: null };
  }
  const blocks: CalendarBlock[] = [];
  const seen = new Set<string>();
  const pushBlock = (b: CalendarBlock) => {
    const key = `${b.start.toISOString()}|${b.end.toISOString()}|${b.title.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    blocks.push(b);
  };
  const rangeStart = localDayBoundsUtc(opts.timezone, start).timeMin;
  const rangeEnd = new Date(start.getTime() + 3 * 86_400_000);

  if (googleCfg) {
    const accounts = await listGoogleAccounts(db, userId);
    for (const acct of accounts) {
      try {
        const { accessToken } = await ensureAccessToken(db, googleCfg, acct);
        const live = await listCalendarRange(
          accessToken,
          rangeStart,
          rangeEnd,
          opts.timezone,
        );
        for (const ev of live) {
          if (ev.status === "cancelled" || !ev.startIso) continue;
          const evStart = new Date(ev.startIso);
          const evEnd = ev.endIso
            ? new Date(ev.endIso)
            : new Date(evStart.getTime() + 60 * 60 * 1000);
          if (Number.isNaN(evStart.getTime()) || Number.isNaN(evEnd.getTime())) continue;
          pushBlock({
            title: (ev.summary ?? "Event").trim() || "Event",
            start: evStart,
            end: evEnd,
            allDay: ev.allDay,
          });
        }
      } catch (err) {
        console.error(
          JSON.stringify({
            event: "calendar_conflict_live_error",
            userId,
            label: acct.label,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    }
  }

  const synced = await listSyncedCalendarBlocks(db, userId, rangeStart, rangeEnd);
  for (const e of synced) {
    pushBlock({
      title: e.title,
      start: e.start,
      end: e.end,
      allDay: e.allDay,
    });
  }

  // Personal schedule memory (pickup/gym/…) — not on Google.
  const schedules = await listScheduleNodesRepo(db, userId);
  for (const b of scheduleBlocksForRange(schedules, opts.timezone, rangeStart, rangeEnd)) {
    pushBlock(b);
  }

  const result = checkSlotConflicts(blocks, start, end, opts.timezone);
  const conflictNote = formatConflictProposalNote(result, opts.timezone);
  return {
    clear: result.clear,
    conflictNote,
    suggested: result.suggested
      ? {
          startIso: result.suggested.start.toISOString(),
          endIso: result.suggested.end.toISOString(),
        }
      : null,
    conflictTitle: result.conflicts[0]?.title ?? null,
  };
}

function orchestratorDeps(): OrchestratorDeps {
  return {
    brain,
    channel: waChannel,
    resolveUserName: async (id) => {
      const u = await getUserById(db, id);
      return u?.name ?? "there";
    },
    isPaused: async (id) => {
      const u = await getUserById(db, id);
      return u?.status === "paused";
    },
    setPaused: async (id, p) => {
      await setUserStatus(db, id, p ? "paused" : "active");
    },
    getContextGraphSummary: async (id) => summarizeContextGraph(db, id),
    getAboutMeSummary: (id) => summarizeAboutMe(db, id),
    getAboutPersonSummary: (id, name) => summarizeAboutPerson(db, id, name),
    forgetContextLabel: (userId, label) => deleteContextNodeByLabel(db, userId, label),
    forgetContextAttr: (userId, label, attr) =>
      forgetContextAttrRepo(db, userId, label, attr),
    clearContextMemory: (userId) => clearContextGraph(db, userId),
    createWaitingOnWatch: async (userId, opts) => {
      const u = await getUserById(db, userId);
      const resolved = await resolvePersonEmail(db, userId, opts.person);
      const personLabel = resolved?.label ?? opts.person.trim();
      const email = resolved?.email ?? null;
      const title = `Waiting on ${personLabel} for ${opts.thing}`.slice(0, 500);
      const commitment = await createCommitment(db, {
        userId,
        title,
        reason: "waiting_on",
      });
      await linkWaitingOnPerson(db, {
        userId,
        userName: u?.name ?? "user",
        personLabel,
        email,
        commitmentId: commitment.id,
      });
      await createWatch(db, {
        userId,
        kind: "awaiting_reply",
        title,
        personLabel,
        email,
        commitmentId: commitment.id,
      });
      // Also arm a stall watch if we ever get a due — for now awaiting_reply only.
      if (!email) {
        return {
          ok: true,
          message: `Watching for ${personLabel} on “${opts.thing}”. I don't have their email yet — tell me e.g. ${personLabel}'s email is … so I can catch their reply.`,
        };
      }
      return {
        ok: true,
        message: `Watching for ${personLabel} (${email}) on “${opts.thing}”. I'll ping when they reply (or say done ${opts.thing.slice(0, 40)}).`,
      };
    },
    cancelWatchByHint: (userId, hint) => cancelWatchesByHint(db, userId, hint),
    getOpenCommitmentsSummary: async (userId) => {
      const u = await getUserById(db, userId);
      return summarizeOpenCommitments(db, userId, u?.timezone ?? "Asia/Kolkata");
    },
    resolveCommitment: (userId, opts) =>
      resolveCommitmentByHint(db, userId, opts.titleHint, opts.status, {
        ...(opts.snoozeUntil ? { snoozeUntil: opts.snoozeUntil } : {}),
      }),
    setPlace: async ({ userId, label, address }) => {
      const key = settings.googleMapsApiKey;
      if (!key) {
        return {
          ok: false,
          message: "Maps isn't configured yet (GOOGLE_MAPS_API_KEY). Places can't be geocoded.",
        };
      }
      const maps = new MapsClient(key);
      const latlng = await geocodeAddress(db, maps, address, userId);
      await upsertPlace(db, {
        userId,
        label,
        address,
        lat: latlng?.lat ?? null,
        lng: latlng?.lng ?? null,
        source: "user",
      });
      if (!latlng) {
        return {
          ok: true,
          message: `Saved ${label}, but couldn't geocode that address yet — leave-by may wait until Maps resolves it.`,
        };
      }
      return {
        ok: true,
        message: `Saved ${label}: ${address}. I'll use it for leave-by times.`,
      };
    },
    listPlacesText: async (userId) => {
      const rows = await listPlaces(db, userId);
      if (!rows.length) {
        return "No places yet — try: home is <address> or office is <address>";
      }
      return [
        "Your places:",
        ...rows.map(
          (p) =>
            `• ${p.label}: ${p.address ?? "?"}${p.lat != null ? "" : " (unresolved)"}`,
        ),
      ].join("\n");
    },
    correctTravelOrigin: async (userId, correctionText) => {
      const key = settings.googleMapsApiKey;
      if (!key) return "Maps isn't configured — can't recompute leave-by.";
      const u = await getUserById(db, userId);
      const maps = new MapsClient(key);
      return correctTravelOrigin(db, maps, {
        userId,
        correctionText,
        prefs: (u?.prefs ?? {}) as Record<string, unknown>,
        timeZone: u?.timezone ?? "Asia/Kolkata",
      });
    },
    resolveContactEmail: (userId, nameHint) => resolvePersonEmail(db, userId, nameHint),
    rememberContactEmail: async (userId, opts) => {
      await rememberPersonEmail(db, userId, opts);
    },
    getRecentChatSummary: (id, opts) =>
      getRecentChatSummary(db, id, 14, {
        ...(opts?.excludeMessageId ? { excludeWaMessageId: opts.excludeMessageId } : {}),
      }),
    applyGraphUpdates: async (opts) => {
      await applyGraphUpdates(db, {
        userId: opts.userId,
        userName: opts.userName,
        claim: opts.message,
        updates: opts.updates,
        ...(opts.sourceMessageId ? { sourceMessageId: opts.sourceMessageId } : {}),
      });
    },
    listScheduleNodes: async (userId) => {
      const rows = await listScheduleNodesRepo(db, userId);
      return rows.map((r) => ({ label: r.label, attrs: r.attrs }));
    },
    upsertScheduleNode: async (userId, opts) => {
      const row = await upsertScheduleNodeRepo(db, userId, opts.label, opts.attrs);
      return { label: row.label };
    },
    clearScheduleHolds: (userId, labelHint) =>
      clearScheduleHoldsRepo(db, userId, labelHint),
    getGoogleAuthUrl: async (userId, label) => {
      if (!googleCfg) return null;
      return buildAuthUrl(googleCfg, userId, label);
    },
    listGoogleAccounts: async (userId) => {
      const rows = await listGoogleAccounts(db, userId);
      return rows.map((r) => ({ label: r.label, email: r.email }));
    },
    disconnectGoogle: async (userId, label) => {
      const r =
        label === "all"
          ? await deleteGoogleAccount(db, userId)
          : await deleteGoogleAccount(db, userId, label);
      console.log(
        JSON.stringify({
          event: "google_disconnected",
          userId,
          label,
          deleted: r.deleted,
          labels: r.labels,
        }),
      );
      return r;
    },
    syncGoogle: async (userId, opts) => {
      if (!googleCfg) throw new Error("Google OAuth not configured");
      const u = await getUserById(db, userId);
      const prefs = await getUserPrefs(db, userId);
      return syncGoogleForUser(
        db,
        googleCfg,
        userId,
        u?.timezone ?? "Asia/Kolkata",
        prefs.mutedPatterns,
        opts?.label,
      );
    },
    searchMail: async (userId, opts) => {
      const accounts = await listGoogleAccounts(db, userId);
      if (!accounts.length) {
        return { hits: [], searchedLive: false, connected: false };
      }
      const prefs = await getUserPrefs(db, userId);
      const local = await searchMailEvents(db, userId, {
        query: opts.query,
        lookbackDays: opts.lookbackDays,
        mutedPatterns: prefs.mutedPatterns,
      });
      if (local.length) {
        return {
          hits: local.map((h) => ({
            from: h.from,
            subject: h.subject,
            snippet: h.snippet,
            ...(h.to ? { to: h.to } : {}),
            date: h.createdAt.toISOString().slice(0, 10),
            ...(h.eventId ? { eventId: h.eventId } : {}),
          })),
          searchedLive: false,
          connected: true,
        };
      }
      if (!googleCfg) {
        return { hits: [], searchedLive: false, connected: true };
      }
      const q = buildGmailSearchQuery(opts.query, opts.lookbackDays);
      const hits: Array<{ from: string; subject: string; snippet: string }> = [];
      for (const account of accounts) {
        try {
          const { accessToken } = await ensureAccessToken(db, googleCfg, account);
          const found = await searchGmail(accessToken, q, 6);
          for (const m of found) {
            hits.push({
              from: m.from.slice(0, 120),
              subject: m.subject.slice(0, 160),
              snippet: m.snippet.replace(/\s+/g, " ").trim().slice(0, 500),
              ...(m.to ? { to: m.to.slice(0, 200) } : {}),
              ...(m.date ? { date: m.date.slice(0, 40) } : {}),
            });
          }
        } catch (err) {
          console.error(
            JSON.stringify({
              event: "gmail_search_failed",
              userId,
              label: account.label,
              error: err instanceof Error ? err.message : String(err),
            }),
          );
        }
        if (hits.length >= 8) break;
      }
      return { hits: hits.slice(0, 8), searchedLive: true, connected: true };
    },
    getMailWorkingSet: async (userId) => {
      const prefs = await getUserPrefs(db, userId);
      return prefs.mailWorkingSet;
    },
    setMailWorkingSet: async (userId, set) => {
      await patchUserPrefs(db, userId, { mailWorkingSet: set });
    },
    isGoogleConnected: async (userId) => {
      const rows = await listGoogleAccounts(db, userId);
      return rows.length > 0;
    },
    getBriefingContext: async (userId) => {
      const u = await getUserById(db, userId);
      const prefs = await getUserPrefs(db, userId);
      const timezone = u?.timezone ?? "Asia/Kolkata";
      return {
        timezone,
        openCommitmentsSummary: await summarizeOpenCommitments(db, userId, timezone),
        calendarToday: await summarizeCalendarToday(db, userId, timezone, {
          includeIds: true,
        }),
        calendarTomorrow: await summarizeCalendarTomorrow(db, userId, timezone, {
          includeIds: true,
        }),
        recentMail: await summarizeRecentMail(
          db,
          userId,
          prefs.mutedPatterns,
          prefs.vipList,
        ),
        ignoredPatterns: prefs.mutedPatterns,
        vipList: prefs.vipList,
      };
    },
    buildPriorityBrief: async (userId, kind = "am") => {
      const u = await getUserById(db, userId);
      const prefs = await getUserPrefs(db, userId);
      const timezone = u?.timezone ?? "Asia/Kolkata";
      const accounts = await listGoogleAccounts(db, userId);
      const brief = await buildPriorityBriefPayload(
        db,
        userId,
        timezone,
        prefs.mutedPatterns,
        prefs.vipList,
        {
          kind,
          closedMailThreads: prefs.closedMailThreads,
          closedMailFingerprints: prefs.closedMailFingerprints,
          attentionState: prefs.attentionState,
          userEmails: accounts.flatMap((a) => (a.email ? [a.email] : [])),
          ...(settings.xaiApiKey
            ? {
                classifyBorderline: (
                  items: Array<{ id: string; from: string; subject: string; snippet: string }>,
                ) =>
                  classifyBorderlineMail(
                    { apiKey: settings.xaiApiKey, model: settings.grokModel },
                    items,
                  ),
              }
            : {}),
        },
      );
      await patchUserPrefs(db, userId, {
        lastBriefItems: brief.items,
        lastBriefMore: kind === "am" ? brief.moreText : prefs.lastBriefMore,
        attentionState: brief.attentionState,
        ...(kind === "am"
          ? {
              lastHandledDay: brief.lastHandledDay,
              lastHandledLines: brief.lastHandledLines,
            }
          : {}),
      });
      return {
        digestText: brief.digestText,
        items: brief.items,
        calendarCount: brief.calendarCount,
        commitmentCount: brief.commitmentCount,
      };
    },
    getLastBriefItems: async (userId) => {
      const prefs = await getUserPrefs(db, userId);
      return { items: prefs.lastBriefItems, more: prefs.lastBriefMore };
    },
    listCompleted: async (userId) => {
      const prefs = await getUserPrefs(db, userId);
      return recentCompleted(prefs.attentionState).map((r) => r.label);
    },
    listHandled: async (userId) => {
      const prefs = await getUserPrefs(db, userId);
      return prefs.lastHandledLines;
    },
    closeBriefPriority: async (userId, opts) => {
      return closeBriefPriorityItem(db, userId, {
        kind:
          opts.kind === "mail" || opts.kind === "commitment" || opts.kind === "calendar"
            ? opts.kind
            : opts.kind
              ? "mail"
              : null,
        eventId: opts.eventId ?? null,
        threadId: opts.threadId ?? null,
        commitmentId: opts.commitmentId ?? null,
        label: opts.label ?? null,
        fingerprint: opts.fingerprint ?? null,
        status: opts.status ?? "done",
      });
    },
    briefingTemplates: {
      morning: settings.wabaTemplateMorning,
      evening: settings.wabaTemplateEvening,
      languageCode: "en",
    },
    addMutedPattern: (userId, pattern) => addMutedPattern(db, userId, pattern),
    removeMutedPattern: (userId, pattern) => removeMutedPattern(db, userId, pattern),
    listMutedPatterns: async (userId) => (await getUserPrefs(db, userId)).mutedPatterns,
    getTimezoneState: async (userId) => {
      const u = await getUserById(db, userId);
      const prefs = await getUserPrefs(db, userId);
      return {
        timezone: u?.timezone ?? "Asia/Kolkata",
        tzConfirmed: prefs.tzConfirmed,
      };
    },
    setTimezone: async (userId, timezone, confirmed) => {
      await setUserTimezone(db, userId, timezone, { confirmed });
    },
    confirmTimezone: async (userId) => {
      await setTimezoneConfirmed(db, userId, true);
    },
    createReminders: async (userId, items) => {
      const u = await getUserById(db, userId);
      const timezone = u?.timezone ?? "Asia/Kolkata";
      const prefs = await getUserPrefs(db, userId);
      const today = localDayBoundsUtc(timezone).day;
      const nudge = async (title: string, at: Date): Promise<boolean> => {
        if (at.getTime() <= Date.now() - 60_000) return false;
        try {
          return await writeReminderCalendarNudge({
            db,
            googleCfg,
            userId,
            timezone,
            title,
            dueAt: at,
          });
        } catch (err) {
          console.error(
            JSON.stringify({
              event: "reminder_calendar_nudge_failed",
              userId,
              error: err instanceof Error ? err.message : String(err),
            }),
          );
          return false;
        }
      };
      const out: Array<{
        title: string;
        dueAt: Date;
        kind: "timed" | "post_brief";
        calendarOk?: boolean;
        fire?: "calendar" | "after_brief" | "soon";
      }> = [];
      for (const item of items) {
        const kind = item.kind ?? "timed";
        if (kind === "post_brief") {
          const dueDay = localDayBoundsUtc(timezone, item.dueAt).day;
          const nineAm = item.dueAt;
          const calendarOk = await nudge(item.title, nineAm);
          if (dueDay === today && prefs.lastMorningBriefDay === today) {
            await createReminder(db, {
              userId,
              title: item.title,
              dueAt: new Date(),
              reason: "reminder",
            });
            out.push({ ...item, kind: "post_brief", fire: "soon", calendarOk });
            continue;
          }
          await createReminder(db, {
            userId,
            title: item.title,
            dueAt: nineAm,
            reason: "reminder_post_brief",
          });
          out.push({ ...item, kind: "post_brief", fire: "after_brief", calendarOk });
          continue;
        }
        await createReminder(db, {
          userId,
          title: item.title,
          dueAt: item.dueAt,
          reason: "reminder",
        });
        const calendarOk = await nudge(item.title, item.dueAt);
        out.push({ ...item, kind: "timed", fire: "calendar", calendarOk });
      }
      return out;
    },
    getBriefSchedule: async (userId) => {
      const u = await getUserById(db, userId);
      const prefs = await getUserPrefs(db, userId);
      return {
        enabled: prefs.briefsEnabled,
        morningHm: prefs.morningHm,
        eveningHm: prefs.eveningHm,
        quietStartHm: prefs.quietStartHm,
        quietEndHm: prefs.quietEndHm,
        timezone: u?.timezone ?? "Asia/Kolkata",
      };
    },
    setBriefsEnabled: async (userId, enabled) => {
      await patchUserPrefs(db, userId, { briefsEnabled: enabled });
    },
    setBriefSlot: async (userId, slot, hm) => {
      if (slot === "morning") await patchUserPrefs(db, userId, { morningHm: hm });
      else await patchUserPrefs(db, userId, { eveningHm: hm });
    },
    setQuietHours: async (userId, startHm, endHm) => {
      await patchUserPrefs(db, userId, {
        quietStartHm: startHm,
        quietEndHm: endHm,
      });
    },
    getOpenPending: async (userId) => {
      const row = await getOpenPendingAction(db, userId);
      if (!row) return null;
      return {
        id: row.id,
        kind: row.kind,
        summary: row.summary,
        payload: row.payload as Record<string, unknown>,
      };
    },
    resolveCalendarEvent: async (userId, opts) => {
      let matches = await findCalendarEventMatches(db, userId, opts);
      if (matches.length || !googleCfg) return matches;

      // Live Google lookup (covers events created before we started upserting).
      const accounts = await listGoogleAccounts(db, userId);
      const today = localDayBoundsUtc(opts.timezone);
      const timeMax = new Date(today.timeMax.getTime() + 24 * 60 * 60 * 1000);
      for (const acct of accounts) {
        try {
          const { accessToken } = await ensureAccessToken(db, googleCfg, acct);
          const live = await listCalendarRange(
            accessToken,
            today.timeMin,
            timeMax,
            opts.timezone,
          );
          for (const ev of live) {
            if (ev.status === "cancelled") continue;
            await upsertEvent(db, {
              userId,
              source: "calendar",
              sourceId: `${acct.id}:${ev.id}`,
              title: ev.summary,
              snippet: ev.location,
              kind: "meeting",
              meta: {
                end: ev.endIso,
                status: ev.status,
                allDay: ev.allDay,
                accountLabel: acct.label,
                accountEmail: acct.email,
                calendarId: ev.id,
              },
              occursAt: ev.startIso ? new Date(ev.startIso) : null,
            });
          }
        } catch (err) {
          console.error(
            JSON.stringify({
              event: "calendar_resolve_live_error",
              userId,
              label: acct.label,
              error: err instanceof Error ? err.message : String(err),
            }),
          );
        }
      }
      matches = await findCalendarEventMatches(db, userId, opts);
      return matches;
    },
    checkCalendarConflict: checkUserCalendarConflict,
    createPending: async (opts) => {
      const row = await createPendingAction(db, {
        userId: opts.userId,
        kind: opts.kind as PendingActionKind,
        summary: opts.summary,
        payload: opts.payload,
      });
      return { id: row.id, kind: row.kind, summary: row.summary };
    },
    confirmPending: async (userId) => {
      const row = await getOpenPendingAction(db, userId);
      if (!row) return { ok: false, message: "Nothing pending to confirm." };
      const u = await getUserById(db, userId);
      const timezone = u?.timezone ?? "Asia/Kolkata";

      // Re-check conflicts on confirm so a missed propose-time check can't write over a busy slot.
      // If the user already saw a conflict warning and said yes, proceed.
      if (row.kind === "calendar_create") {
        const payload = { ...(row.payload as Record<string, unknown>) };
        const alreadyWarned =
          Boolean(payload.conflictWarning) || Boolean(payload.conflictAdjusted);
        if (!alreadyWarned) {
          const startIso = String(payload.start ?? payload.startIso ?? "").trim();
          const endIso = String(payload.end ?? payload.endIso ?? "").trim();
          if (startIso && endIso) {
            try {
              const conflict = await checkUserCalendarConflict(userId, {
                startIso,
                endIso,
                timezone,
              });
              if (!conflict.clear) {
                payload.conflictWarning = true;
                if (conflict.conflictTitle) payload.conflictWith = conflict.conflictTitle;
                if (conflict.suggested) {
                  payload.suggestedStart = conflict.suggested.startIso;
                  payload.suggestedEnd = conflict.suggested.endIso;
                }
                await updatePendingPayload(db, row.id, payload);
                return {
                  ok: true,
                  message: [
                    conflict.conflictNote ??
                      "That slot conflicts with something on your calendar.",
                    "",
                    "Reply yes to go ahead anyway, alternate for next free, or cancel.",
                  ].join("\n"),
                };
              }
            } catch (err) {
              console.error(
                JSON.stringify({
                  event: "calendar_confirm_conflict_check_failed",
                  userId,
                  error: err instanceof Error ? err.message : String(err),
                }),
              );
            }
          }
        }
      }

      return executePendingAction(db, googleCfg, row, timezone);
    },
    rejectPending: async (userId) => {
      const row = await getOpenPendingAction(db, userId);
      if (!row) return { ok: false, message: "Nothing pending to cancel." };
      return rejectPendingAction(db, row, googleCfg);
    },
    editPending: async (userId, patch, summary) => {
      const row = await getOpenPendingAction(db, userId);
      if (!row) return { ok: false, message: "Nothing pending to edit." };
      const nextPayload = { ...(row.payload as Record<string, unknown>), ...patch };
      const updated = await updatePendingPayload(db, row.id, nextPayload, summary);
      return {
        ok: Boolean(updated),
        message: updated?.summary ?? row.summary,
      };
    },
    logEval: async (userId, note) => {
      await logEvalEvent(db, {
        userId,
        event: "manual_note",
        note,
        bot: "amilo-wa",
        channel: "whatsapp",
      });
    },
  };
}

async function sendAndLogOutbound(
  userId: string,
  msg: { text: string } | { templateName: string; languageCode: string; variables: string[] },
  extraMeta: Record<string, unknown> = {},
): Promise<void> {
  const waMessageId = await waChannel.send(userId, msg);
  const isTemplate = "templateName" in msg;
  await logMessage(db, {
    userId,
    channel: "whatsapp",
    direction: "out",
    kind: isTemplate ? "template" : "text",
    bodyRef: isTemplate
      ? (msg.variables.join(" · ").slice(0, 500) || msg.templateName)
      : msg.text.slice(0, 500),
    meta: {
      ...(waMessageId ? { waMessageId } : {}),
      ...(isTemplate ? { template: msg.templateName } : {}),
      ...extraMeta,
    },
  });
}

async function processInbound(rawJson: unknown): Promise<void> {
  const messages = parseWhatsAppWebhook(rawJson);
  for (const parsed of messages) {
    const claimed = await claimWebhookMessage(db, parsed.messageId);
    if (!claimed) {
      console.log(JSON.stringify({ event: "wa_dup_skip", id: parsed.messageId }));
      continue;
    }

    if (!(await isPhoneAllowlisted(db, parsed.waId, settings.allowedPhones))) {
      console.log(
        JSON.stringify({
          event: "wa_ignored_not_allowlisted",
          waId: parsed.waId.slice(0, 4) + "…",
        }),
      );
      continue;
    }

    const user = await upsertWhatsAppUser(db, {
      phoneE164: parsed.phoneE164,
      waId: parsed.waId,
      ...(parsed.profileName ? { profileName: parsed.profileName } : {}),
    });
    await touchWhatsAppInbound(db, parsed.waId, parsed.timestamp);
    await markAccessRequestActiveByPhone(db, parsed.phoneE164, user.id);

    if (
      !isUsageCapExemptPhone(parsed.phoneE164, settings.usageCapExemptPhones)
    ) {
      const caps = await checkUsageCaps(
        db,
        user.id,
        {
          day: settings.usageDayCap,
          week: settings.usageWeekCap,
        },
        { timeZone: user.timezone || "Asia/Kolkata" },
      );
      if (!caps.ok) {
        await sendAndLogOutbound(user.id, { text: caps.message });
        continue;
      }
    }

    let replyToContent: string | undefined;
    let replyToDirection: "in" | "out" | undefined;
    if (parsed.replyToMessageId) {
      const prior = await findMessageByWaId(db, user.id, parsed.replyToMessageId);
      if (prior?.bodyRef) {
        replyToContent = prior.bodyRef;
        replyToDirection = prior.direction === "out" ? "out" : "in";
      }
    }

    await logMessage(db, {
      userId: user.id,
      channel: "whatsapp",
      direction: "in",
      kind: parsed.kind,
      bodyRef: parsed.content.slice(0, 500),
      meta: {
        waMessageId: parsed.messageId,
        ...(parsed.replyToMessageId ? { replyToMessageId: parsed.replyToMessageId } : {}),
      },
    });

    let content = parsed.content;
    let voiceHeard: string | null = null;

    if (parsed.kind === "voice") {
      if (!parsed.mediaId) {
        await sendAndLogOutbound(user.id, {
          text: "Couldn't read that voice note — try again, or send text.",
        });
        continue;
      }
      if (!settings.sarvamApiKey) {
        await sendAndLogOutbound(user.id, {
          text: "Voice notes need Sarvam configured — send text for now, or help.",
        });
        continue;
      }
      try {
        const { bytes } = await downloadWhatsAppMedia(
          {
            accessToken: settings.wabaAccessToken,
            phoneNumberId: settings.wabaPhoneNumberId,
            appSecret: settings.wabaAppSecret,
          },
          parsed.mediaId,
        );
        const result = await processVoiceNote(bytes, {
          apiKey: settings.sarvamApiKey,
          model: settings.sarvamModel,
          languageCode: settings.sarvamLanguageCode,
          ...(settings.sarvamModel.startsWith("saaras:")
            ? { mode: "transcribe" as const }
            : {}),
        });
        content = result.text.trim();
        if (!content) {
          await sendAndLogOutbound(user.id, {
            text: "Couldn't make out that voice note — try again a bit clearer, or send text.",
          });
          continue;
        }
        voiceHeard = content;
        await recordUsage(db, {
          userId: user.id,
          kind: "stt",
          units: 1,
          costMicros: USAGE_COST_MICROS.stt,
          meta: { model: settings.sarvamModel },
        });
        await logMessage(db, {
          userId: user.id,
          channel: "whatsapp",
          direction: "in",
          kind: "voice_transcript",
          bodyRef: content.slice(0, 500),
          meta: {
            waMessageId: parsed.messageId,
            mediaId: parsed.mediaId,
            asr: "sarvam",
            model: settings.sarvamModel,
          },
        });
      } catch (err) {
        console.error(
          JSON.stringify({
            event: "voice_pipeline_failed",
            userId: user.id,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
        await sendAndLogOutbound(user.id, {
          text: "Voice note failed to process — try again, or send text.",
        });
        continue;
      }
    }

    const inbound: InboundMessage = {
      userId: user.id,
      channel: "whatsapp",
      kind: parsed.kind === "voice" ? "text" : parsed.kind,
      content,
      messageId: parsed.messageId,
      ts: parsed.timestamp,
      ...(parsed.mediaId ? { mediaRef: parsed.mediaId } : {}),
      ...(parsed.replyToMessageId ? { replyToMessageId: parsed.replyToMessageId } : {}),
      ...(replyToContent ? { replyToContent } : {}),
      ...(replyToDirection ? { replyToDirection } : {}),
    };

    console.log(
      JSON.stringify({
        event: "wa_inbound",
        userId: user.id,
        phone: parsed.phoneE164,
        kind: parsed.kind,
        chars: content.length,
        brain: brainLabel,
        ...(voiceHeard ? { transcript: voiceHeard.slice(0, 120) } : {}),
        ...(parsed.replyToMessageId ? { replyTo: parsed.replyToMessageId } : {}),
      }),
    );

    try {
      let outbound = await handleInbound(inbound, orchestratorDeps());
      // LifeOS lesson: echo Heard in the first reply — no separate transcript confirm.
      if (voiceHeard && outbound.length) {
        const first = outbound[0];
        if (first && "text" in first && first.text && !first.text.startsWith("Heard:")) {
          outbound = [{ text: `Heard: "${voiceHeard}"\n\n${first.text}` }, ...outbound.slice(1)];
        }
      }

      for (const msg of outbound) {
        await sendAndLogOutbound(user.id, msg);
      }
      await recordUsage(db, {
        userId: user.id,
        kind: "brain",
        units: 1,
        costMicros: USAGE_COST_MICROS.brain,
        meta: { brain: brainLabel, outbound: outbound.length },
      });
      console.log(
        JSON.stringify({
          event: "wa_outbound",
          userId: user.id,
          count: outbound.length,
        }),
      );
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(JSON.stringify({ event: "wa_process_error", error: errMsg }));
      try {
        const text =
          /permission-denied|credits or licenses/i.test(errMsg)
            ? "Grok API has no credits on this xAI team — add billing at console.x.ai, then try again."
            : "Something went wrong on my side — try again in a moment.";
        await sendAndLogOutbound(user.id, { text });
      } catch {
        /* already logged */
      }
    }
  }
}

app.get("/health", async (c) => {
  let dbOk = false;
  try {
    await db.execute(sql`select 1`);
    dbOk = true;
  } catch {
    dbOk = false;
  }
  return c.json({
    ok: true,
    service: "amilo",
    brain: brainLabel,
    google: googleOk ? "configured" : "off",
    db: dbOk ? "up" : "down",
    voice: settings.sarvamApiKey ? "sarvam" : "off",
    milestone: "M5.5",
  });
});

function adminAuthorized(c: Parameters<typeof adminAuthOk>[0], bodyToken?: string): boolean {
  if (settings.adminToken && adminAuthOk(c, settings.adminToken)) return true;
  if (bodyToken && settings.adminToken && bodyToken === settings.adminToken) return true;
  return false;
}

async function requireAdminEmail(
  c: Parameters<typeof adminAuthOk>[0],
): Promise<string | null> {
  const sessionTok = getAdminSessionToken(c);
  const email = await getAdminSessionEmail(db, sessionTok);
  if (email) return email;
  // Emergency: legacy ADMIN_TOKEN still works as a session-less cookie/query.
  if (adminAuthorized(c)) return settings.adminEmail || "admin";
  return null;
}

const ACCESS_CORS_ORIGINS = new Set([
  "https://amilo.io",
  "https://www.amilo.io",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

function accessCorsHeaders(origin: string | undefined): Record<string, string> {
  if (origin && ACCESS_CORS_ORIGINS.has(origin)) {
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      Vary: "Origin",
    };
  }
  return {};
}

app.options("/access-requests", (c) => {
  const headers = accessCorsHeaders(c.req.header("origin"));
  return new Response(null, { status: 204, headers });
});

app.post("/access-requests", async (c) => {
  const origin = c.req.header("origin");
  const headers = accessCorsHeaders(origin);
  try {
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") {
      return c.json({ ok: false, error: "Expected JSON body" }, 400, headers);
    }
    // Honeypot (website uses `company`)
    if (String(body.company ?? body.botcheck ?? "").trim()) {
      return c.json({ ok: true }, 200, headers);
    }
    const row = await createAccessRequest(db, {
      name: String(body.name ?? ""),
      phone: String(body.phone ?? ""),
      email: String(body.email ?? ""),
      source: body.source != null ? String(body.source) : null,
      detail: body.detail != null ? String(body.detail) : null,
      pageUrl: body.page != null ? String(body.page) : body.pageUrl != null ? String(body.pageUrl) : null,
    });
    return c.json(
      { ok: true, id: row.id, status: row.status },
      200,
      headers,
    );
  } catch (e) {
    return c.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      400,
      headers,
    );
  }
});

app.get("/admin/login", async (c) => {
  const email = await requireAdminEmail(c);
  if (email) return c.redirect("/admin");
  return c.html(renderAdminLogin({ emailHint: settings.adminEmail }));
});

app.post("/admin/login", async (c) => {
  const body = await c.req.parseBody();
  const email = normalizeEmail(String(body.email ?? ""));
  const password = String(body.password ?? "");
  const allowed = settings.adminEmail;
  if (!allowed) {
    return c.html(
      renderAdminLogin({ error: "ADMIN_EMAIL is not configured.", emailHint: email }),
      503,
    );
  }
  if (email !== allowed) {
    return c.html(
      renderAdminLogin({ error: "Unknown admin account.", emailHint: email }),
      401,
    );
  }
  const ok = adminPasswordMatches(password, {
    passwordPlain: settings.adminPassword,
    passwordHash: settings.adminPasswordHash,
    passwordSalt: settings.adminPasswordSalt,
  });
  if (!ok) {
    return c.html(
      renderAdminLogin({ error: "Wrong password.", emailHint: email }),
      401,
    );
  }
  const session = await createAdminSession(db, email);
  c.header("Set-Cookie", setAdminSessionCookie(session.token));
  return c.redirect("/admin");
});

app.post("/admin/logout", async (c) => {
  await destroyAdminSession(db, getAdminSessionToken(c));
  c.header("Set-Cookie", clearAdminSessionCookie());
  return c.redirect("/admin/login");
});

app.get("/admin", async (c) => {
  const email = await requireAdminEmail(c);
  if (!email) {
    if (c.req.query("token") && settings.adminToken && c.req.query("token") === settings.adminToken) {
      c.header("Set-Cookie", setAdminCookie(settings.adminToken));
      return c.redirect("/admin");
    }
    return c.redirect("/admin/login");
  }
  if (!(settings.adminPassword || settings.adminPasswordHash) && !settings.adminToken) {
    return c.text("Set ADMIN_PASSWORD (or ADMIN_TOKEN) to enable the admin dashboard.", 503);
  }
  const tab = String(c.req.query("tab") ?? "overview");
  const html = await renderAdminDashboard({
    db,
    publicBaseUrl: settings.publicBaseUrl,
    email,
    tab,
    ...(c.req.query("msg") ? { message: String(c.req.query("msg")) } : {}),
  });
  return c.html(html);
});

app.post("/admin/phones/add", async (c) => {
  const email = await requireAdminEmail(c);
  if (!email) return c.redirect("/admin/login");
  const body = await c.req.parseBody();
  const phone = String(body.phone ?? "");
  const label = String(body.label ?? "");
  try {
    await addAllowedPhone(db, {
      phoneE164: phone,
      ...(label ? { label } : {}),
    });
  } catch (e) {
    const html = await renderAdminDashboard({
      db,
      publicBaseUrl: settings.publicBaseUrl,
      email,
      tab: "users",
      error: e instanceof Error ? e.message : String(e),
    });
    return c.html(html, 400);
  }
  return c.redirect("/admin?tab=users&msg=" + encodeURIComponent("Phone added."));
});

app.post("/admin/phones/remove", async (c) => {
  const email = await requireAdminEmail(c);
  if (!email) return c.redirect("/admin/login");
  const body = await c.req.parseBody();
  await deactivateAllowedPhone(db, String(body.phone ?? ""));
  return c.redirect("/admin?tab=users&msg=" + encodeURIComponent("Phone disabled."));
});

app.post("/admin/invites/create", async (c) => {
  const email = await requireAdminEmail(c);
  if (!email) return c.redirect("/admin/login");
  const body = await c.req.parseBody();
  const phone = String(body.phone ?? "").trim();
  const label = String(body.label ?? "").trim();
  const maxUses = Number(body.maxUses ?? 1) || 1;
  try {
    await createInvite(db, {
      ...(phone ? { phoneE164: phone } : {}),
      ...(label ? { label } : {}),
      maxUses,
      expiresInDays: 14,
    });
  } catch (e) {
    const html = await renderAdminDashboard({
      db,
      publicBaseUrl: settings.publicBaseUrl,
      email,
      tab: "invites",
      error: e instanceof Error ? e.message : String(e),
    });
    return c.html(html, 400);
  }
  return c.redirect("/admin?tab=invites&msg=" + encodeURIComponent("Invite created."));
});

app.post("/admin/requests/approve", async (c) => {
  const email = await requireAdminEmail(c);
  if (!email) return c.redirect("/admin/login");
  const body = await c.req.parseBody();
  try {
    const r = await approveAccessRequest(db, String(body.id ?? ""));
    const url = `${settings.publicBaseUrl}${r.inviteUrlPath}`;
    return c.redirect(
      "/admin?tab=requests&msg=" +
        encodeURIComponent(`Approved ${r.request.name}. Invite: ${url}`),
    );
  } catch (e) {
    const html = await renderAdminDashboard({
      db,
      publicBaseUrl: settings.publicBaseUrl,
      email,
      tab: "requests",
      error: e instanceof Error ? e.message : String(e),
    });
    return c.html(html, 400);
  }
});

app.post("/admin/requests/decline", async (c) => {
  const email = await requireAdminEmail(c);
  if (!email) return c.redirect("/admin/login");
  const body = await c.req.parseBody();
  await decideAccessRequest(db, String(body.id ?? ""), { status: "declined" });
  return c.redirect("/admin?tab=requests&msg=" + encodeURIComponent("Declined."));
});

app.post("/admin/requests/spam", async (c) => {
  const email = await requireAdminEmail(c);
  if (!email) return c.redirect("/admin/login");
  const body = await c.req.parseBody();
  await decideAccessRequest(db, String(body.id ?? ""), { status: "spam" });
  return c.redirect("/admin?tab=requests&msg=" + encodeURIComponent("Marked spam."));
});

app.get("/i/:token", async (c) => {
  const token = c.req.param("token");
  const invite = await getInviteByToken(db, token);
  if (!invite) return c.html(renderInvitePage({
    token,
    publicBaseUrl: settings.publicBaseUrl,
    waDisplayPhone: settings.wabaDisplayPhone,
    invitePhone: null,
    open: false,
  }), 404);

  if (!settings.wabaDisplayPhone) {
    return c.html(
      renderInvitePage({
        token,
        publicBaseUrl: settings.publicBaseUrl,
        waDisplayPhone: "",
        invitePhone: invite.phoneE164,
        open: false,
        error: "Invite landing misconfigured (WABA_DISPLAY_PHONE).",
      }),
      503,
    );
  }

  // Pre-bound phone: allowlisted at invite creation; claim bumps useCount once, then always show WA.
  if (invite.phoneE164) {
    if (inviteIsOpen(invite)) {
      await claimInvite(db, token);
    }
    const wa = waMeUrl(settings.wabaDisplayPhone, "Hi Amilo");
    return c.html(
      renderInvitePage({
        token,
        publicBaseUrl: settings.publicBaseUrl,
        waDisplayPhone: settings.wabaDisplayPhone,
        invitePhone: invite.phoneE164,
        open: true,
        claimedWaUrl: wa,
      }),
    );
  }

  return c.html(
    renderInvitePage({
      token,
      publicBaseUrl: settings.publicBaseUrl,
      waDisplayPhone: settings.wabaDisplayPhone,
      invitePhone: null,
      open: inviteIsOpen(invite),
    }),
  );
});

app.post("/i/:token", async (c) => {
  const token = c.req.param("token");
  const body = await c.req.parseBody();
  const phone = String(body.phone ?? "");
  const result = await claimInvite(db, token, phone);
  if (!result.ok) {
    const invite = await getInviteByToken(db, token);
    return c.html(
      renderInvitePage({
        token,
        publicBaseUrl: settings.publicBaseUrl,
        waDisplayPhone: settings.wabaDisplayPhone,
        invitePhone: invite?.phoneE164 ?? null,
        open: invite ? inviteIsOpen(invite) : false,
        error: result.reason,
      }),
      400,
    );
  }
  if (!settings.wabaDisplayPhone) {
    return c.text("WABA_DISPLAY_PHONE not configured", 503);
  }
  return c.redirect(waMeUrl(settings.wabaDisplayPhone, "Hi Amilo"));
});

app.get("/i/:token/qr", async (c) => {
  const token = c.req.param("token");
  const invite = await getInviteByToken(db, token);
  if (!invite) return c.text("Invite not found", 404);
  // Pre-bound: QR opens WhatsApp even after invite is "used". Self-serve: landing page while open.
  if (invite.phoneE164 && settings.wabaDisplayPhone) {
    const png = await buildQrPngDataUrl(waMeUrl(settings.wabaDisplayPhone, "Hi Amilo"));
    return new Response(new Uint8Array(png), {
      status: 200,
      headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
    });
  }
  if (!inviteIsOpen(invite)) return c.text("Invite closed", 404);
  const png = await buildQrPngDataUrl(`${settings.publicBaseUrl}/i/${token}`);
  return new Response(new Uint8Array(png), {
    status: 200,
    headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
  });
});

app.get("/oauth/google/callback", async (c) => {
  if (!googleCfg) {
    return c.html("<h1>Google OAuth not configured</h1>", 503);
  }
  const err = c.req.query("error");
  if (err) {
    return c.html(`<h1>Google connect cancelled</h1><p>${err}</p>`, 400);
  }
  const code = c.req.query("code");
  const state = c.req.query("state");
  if (!code || !state) {
    return c.html("<h1>Missing code/state</h1>", 400);
  }
  try {
    const { userId, label } = decodeState(googleCfg, state);
    const tokens = await exchangeCode(googleCfg, code);
    if (!tokens.refreshToken) {
      return c.html(
        "<h1>No refresh token</h1><p>Revoke Amilo access in Google Account permissions and try connect google again with consent.</p>",
        400,
      );
    }
    const email = await fetchEmail(tokens.accessToken);
    await upsertGoogleAccount(db, {
      userId,
      label,
      email,
      scopes: tokens.scope || googleCfg.clientId,
      accessTokenEnc: encryptToken(googleCfg.encryptionKey, tokens.accessToken),
      refreshTokenEnc: encryptToken(googleCfg.encryptionKey, tokens.refreshToken),
      expiresAt: tokens.expiresAt,
    });
    console.log(JSON.stringify({ event: "google_connected", userId, email, label }));
    return c.html(
      `<!doctype html><html><body style="font-family:system-ui;padding:2rem">
        <h1>Amilo connected</h1>
        <p>Linked <strong>${email}</strong> as <code>${label}</code>. Return to WhatsApp and send <code>sync</code> or <code>brief</code>.</p>
        <p>Add another inbox: <code>connect google work</code> (or any label).</p>
      </body></html>`,
    );
  } catch (e) {
    console.error(
      JSON.stringify({
        event: "google_oauth_error",
        error: e instanceof Error ? e.message : String(e),
      }),
    );
    return c.html(
      `<h1>Connect failed</h1><p>${e instanceof Error ? e.message : String(e)}</p>`,
      400,
    );
  }
});

app.get("/webhooks/whatsapp", (c) => {
  const mode = c.req.query("hub.mode");
  const token = c.req.query("hub.verify_token");
  const challenge = c.req.query("hub.challenge");
  if (mode === "subscribe" && token === settings.wabaVerifyToken && challenge) {
    return c.text(challenge);
  }
  return c.text("Forbidden", 403);
});

app.post("/webhooks/whatsapp", async (c) => {
  const raw = Buffer.from(await c.req.arrayBuffer());
  if (settings.wabaAppSecret) {
    const sig = c.req.header("x-hub-signature-256");
    if (!verifyWebhookSignature(settings.wabaAppSecret, raw, sig)) {
      console.error(JSON.stringify({ event: "wa_bad_signature" }));
      return c.json({ error: "invalid signature" }, 401);
    }
  }

  let json: unknown = {};
  try {
    json = JSON.parse(raw.toString("utf8"));
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }

  try {
    await processInbound(json);
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "wa_async_error",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }

  return c.json({ received: true });
});

app.post("/dev/chat", async (c) => {
  if (settings.nodeEnv === "production") {
    return c.json({ error: "disabled in production" }, 404);
  }
  const body = await c.req.json<{ phone?: string; text?: string; name?: string }>();
  const phone = body.phone ?? settings.allowedPhones[0] ?? "+910000000000";
  const waId = phone.replace(/\D/g, "");
  const user = await upsertWhatsAppUser(db, {
    phoneE164: phone.startsWith("+") ? phone : `+${waId}`,
    waId,
    ...(body.name ? { profileName: body.name } : {}),
  });
  const deps = orchestratorDeps();
  const outbound = await handleInbound(
    {
      userId: user.id,
      channel: "web",
      kind: "text",
      content: body.text ?? "",
      ts: new Date(),
    },
    {
      ...deps,
      channel: {
        async send() {
          /* no-op */
        },
      },
      resolveUserName: async () => body.name ?? user.name ?? "Sameep",
    },
  );
  return c.json({ userId: user.id, brain: brainLabel, outbound });
});

const port = settings.port;
serve({ fetch: app.fetch, port, createServer }, (info) => {
  console.log(
    `Amilo API listening on :${info.port} (brain=${brainLabel}, google=${googleOk ? "on" : "off"}, maps=${settings.googleMapsApiKey ? "on" : "off"}, milestone=M5.5)`,
  );
});

startReminderWorker({
  db,
  channel: waChannel,
  alertTemplate: settings.wabaTemplateAlert,
  languageCode: "en",
  intervalMs: 30_000,
});

startTravelWorker({
  db,
  channel: waChannel,
  mapsApiKey: settings.googleMapsApiKey || null,
  alertTemplate: settings.wabaTemplateAlert,
  languageCode: "en",
  intervalMs: 60_000,
});

startWatchWorker({
  db,
  channel: waChannel,
  alertTemplate: settings.wabaTemplateAlert,
  languageCode: "en",
  intervalMs: 120_000,
  googleCfg,
});

startBriefWorker({
  db,
  channel: waChannel,
  googleCfg,
  morningTemplate: settings.wabaTemplateMorning,
  eveningTemplate: settings.wabaTemplateEvening,
  languageCode: "en",
  intervalMs: 60_000,
  grok: settings.xaiApiKey
    ? { apiKey: settings.xaiApiKey, model: settings.grokModel }
    : null,
});

void scrubSeededKnownContacts(db, settings.allowedPhones)
  .then((n) => {
    if (n) {
      console.log(JSON.stringify({ event: "scrubbed_seeded_contacts", removed: n }));
    }
  })
  .catch((err) => {
    console.error(
      JSON.stringify({
        event: "scrub_seeded_contacts_failed",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  });
