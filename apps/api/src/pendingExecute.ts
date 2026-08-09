import { formatLocalIsoWall, parseIsoDate } from "@amilo/core";
import {
  cancelCalendarEvent,
  createCalendarEvent,
  patchCalendarEvent,
  type GoogleOAuthConfig,
} from "@amilo/google";
import {
  appendAudit,
  deleteCalendarEventByGoogleId,
  getGoogleAccount,
  listGoogleAccounts,
  logEvalEvent,
  resolvePendingAction,
  upsertEvent,
  type Db,
  type PendingActionRow,
} from "@amilo/db";
import { ensureAccessToken } from "./googleSync.js";

function str(v: unknown, fallback = ""): string {
  return v == null ? fallback : String(v).trim();
}

function toGoogleWall(iso: string, timezone: string): string {
  const d = parseIsoDate(iso);
  if (!d) return iso;
  // Already a bare local datetime
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(iso) && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(iso)) {
    return iso.slice(0, 19);
  }
  return formatLocalIsoWall(d, timezone);
}

async function resolveAccountToken(
  db: Db,
  cfg: GoogleOAuthConfig,
  userId: string,
  accountLabel: string,
): Promise<{ accessToken: string; label: string }> {
  const label = accountLabel || "personal";
  const named = await getGoogleAccount(db, userId, label);
  const account = named ?? (await listGoogleAccounts(db, userId))[0];
  if (!account) throw new Error("No Google account linked. Send: connect google personal");
  const { accessToken } = await ensureAccessToken(db, cfg, account);
  return { accessToken, label: account.label };
}

export async function executePendingAction(
  db: Db,
  cfg: GoogleOAuthConfig | null,
  row: PendingActionRow,
  timezone: string,
): Promise<{ ok: boolean; message: string }> {
  const payload = (row.payload ?? {}) as Record<string, unknown>;

  try {
    if (row.kind === "email_draft") {
      await resolvePendingAction(db, row.id, {
        status: "confirmed",
        result: { noted: true },
      });
      await appendAudit(db, {
        userId: row.userId,
        action: "email_draft_ack",
        detail: { pendingId: row.id, to: payload.to, subject: payload.subject },
        confirmed: true,
      });
      await logEvalEvent(db, {
        userId: row.userId,
        event: "action_confirmed",
        note: "email_draft",
        meta: { pendingId: row.id },
      });
      return { ok: true, message: "Draft kept — paste it into Gmail when ready (Amilo doesn't send mail yet)." };
    }

    if (!cfg) throw new Error("Google OAuth not configured");

    const accountLabel = str(payload.accountLabel, "personal");
    const { accessToken, label } = await resolveAccountToken(
      db,
      cfg,
      row.userId,
      accountLabel,
    );

    if (row.kind === "calendar_create") {
      const title = str(payload.title, "Untitled");
      const startIso = str(payload.start ?? payload.startIso);
      const endIso = str(payload.end ?? payload.endIso);
      if (!startIso || !endIso) throw new Error("Missing start/end for calendar event");
      const attendees = Array.isArray(payload.attendees)
        ? payload.attendees.map((a) => String(a).trim()).filter((a) => a.includes("@"))
        : typeof payload.attendees === "string" && payload.attendees.includes("@")
          ? [str(payload.attendees)]
          : [];
      const created = await createCalendarEvent(accessToken, {
        title,
        startIso: toGoogleWall(startIso, timezone),
        endIso: toGoogleWall(endIso, timezone),
        timezone,
        location: payload.location ? str(payload.location) : null,
        description: payload.description ? str(payload.description) : null,
        attendees: attendees.length ? attendees : null,
      });
      const account = (await getGoogleAccount(db, row.userId, label)) ??
        (await listGoogleAccounts(db, row.userId))[0];
      if (account) {
        await upsertEvent(db, {
          userId: row.userId,
          source: "calendar",
          sourceId: `${account.id}:${created.id}`,
          title: created.summary ?? title,
          snippet: created.location,
          kind: "meeting",
          meta: {
            end: created.endIso,
            status: created.status,
            allDay: created.allDay,
            accountLabel: label,
            accountEmail: account.email,
            calendarId: created.id,
          },
          occursAt: created.startIso ? new Date(created.startIso) : null,
        });
      }
      await resolvePendingAction(db, row.id, {
        status: "confirmed",
        result: { eventId: created.id, accountLabel: label },
      });
      await appendAudit(db, {
        userId: row.userId,
        action: "calendar_create",
        detail: { pendingId: row.id, eventId: created.id, title, accountLabel: label },
        confirmed: true,
      });
      await logEvalEvent(db, {
        userId: row.userId,
        event: "action_confirmed",
        note: "calendar_create",
        meta: { pendingId: row.id, eventId: created.id },
      });
      return {
        ok: true,
        message: attendees.length
          ? `Added to Google Calendar (${label}): ${title} — invited ${attendees.join(", ")}`
          : `Added to Google Calendar (${label}): ${title}`,
      };
    }

    if (row.kind === "calendar_update") {
      const eventId = str(payload.eventId);
      if (!eventId) throw new Error("Missing eventId to update");
      const patched = await patchCalendarEvent(accessToken, eventId, {
        ...(payload.title ? { title: str(payload.title) } : {}),
        ...(payload.start || payload.startIso
          ? { startIso: toGoogleWall(str(payload.start ?? payload.startIso), timezone) }
          : {}),
        ...(payload.end || payload.endIso
          ? { endIso: toGoogleWall(str(payload.end ?? payload.endIso), timezone) }
          : {}),
        timezone,
        ...(payload.location !== undefined ? { location: str(payload.location) } : {}),
      });
      await resolvePendingAction(db, row.id, {
        status: "confirmed",
        result: { eventId: patched.id, accountLabel: label },
      });
      await appendAudit(db, {
        userId: row.userId,
        action: "calendar_update",
        detail: { pendingId: row.id, eventId: patched.id, accountLabel: label },
        confirmed: true,
      });
      await logEvalEvent(db, {
        userId: row.userId,
        event: "action_confirmed",
        note: "calendar_update",
        meta: { pendingId: row.id },
      });
      return { ok: true, message: `Updated calendar event (${label}).` };
    }

    if (row.kind === "calendar_cancel") {
      const eventId = str(payload.eventId);
      if (!eventId) throw new Error("Missing eventId to cancel");
      await cancelCalendarEvent(accessToken, eventId);
      await deleteCalendarEventByGoogleId(db, row.userId, eventId);
      await resolvePendingAction(db, row.id, {
        status: "confirmed",
        result: { eventId, accountLabel: label },
      });
      await appendAudit(db, {
        userId: row.userId,
        action: "calendar_cancel",
        detail: { pendingId: row.id, eventId, accountLabel: label },
        confirmed: true,
      });
      await logEvalEvent(db, {
        userId: row.userId,
        event: "action_confirmed",
        note: "calendar_cancel",
        meta: { pendingId: row.id },
      });
      return { ok: true, message: `Cancelled calendar event (${label}).` };
    }

    throw new Error(`Unsupported action kind: ${row.kind}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await resolvePendingAction(db, row.id, {
      status: "failed",
      result: { error: message },
    });
    await appendAudit(db, {
      userId: row.userId,
      action: `${row.kind}_failed`,
      detail: { pendingId: row.id, error: message },
      confirmed: false,
    });
    return { ok: false, message };
  }
}

export async function rejectPendingAction(
  db: Db,
  row: PendingActionRow,
): Promise<void> {
  await resolvePendingAction(db, row.id, { status: "rejected", result: {} });
  await appendAudit(db, {
    userId: row.userId,
    action: `${row.kind}_rejected`,
    detail: { pendingId: row.id },
    confirmed: false,
  });
  await logEvalEvent(db, {
    userId: row.userId,
    event: "action_rejected",
    note: row.kind,
    meta: { pendingId: row.id },
  });
}
