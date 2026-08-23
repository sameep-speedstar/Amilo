import type { Context } from "hono";
import type { Db } from "@amilo/db";
import {
  addAllowedPhone,
  claimInvite,
  countInvitesSummary,
  createInvite,
  deactivateAllowedPhone,
  formatUsdFromMicros,
  getBriefQualityStats,
  getInviteByToken,
  getInviteFunnelByDay,
  getOnboardingStats,
  getUserInspect,
  getWatcherQualityStats,
  inviteIsOpen,
  listAccessRequests,
  listAllowedPhones,
  listInvites,
  listUsageByKindDay,
  listUsageByUser,
  listUsersForAdmin,
  waMeUrl,
  type AccessRequestRow,
  type AdminUserInspect,
  type AdminUserRow,
} from "@amilo/db";
import type { WorkerHeartbeat } from "./workerStatus.js";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function parseCookie(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of raw.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (!k) continue;
    out[k] = decodeURIComponent(rest.join("=") || "");
  }
  return out;
}

export function adminAuthOk(c: Context, adminToken: string): boolean {
  if (!adminToken) return false;
  const hdr = c.req.header("x-admin-token") ?? "";
  const q = c.req.query("token") ?? "";
  const cookie = parseCookie(c.req.header("cookie") ?? "").admin_token ?? "";
  return hdr === adminToken || q === adminToken || cookie === adminToken;
}

export function getAdminSessionToken(c: Context): string | null {
  return parseCookie(c.req.header("cookie") ?? "").amilo_admin ?? null;
}

export function setAdminCookie(token: string): string {
  return `admin_token=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`;
}

export function setAdminSessionCookie(token: string, maxAgeSec = 14 * 86400): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `amilo_admin=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=${maxAgeSec}`;
}

export function clearAdminSessionCookie(): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `amilo_admin=; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=0`;
}

const CSS = `
:root { color-scheme: light; --ink:#1a1a1a; --muted:#666; --line:#e5e5e5; --accent:#0b6e4f; --bg:#f7f6f2; --warn:#b45309; }
body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 0; background: var(--bg); color: var(--ink); }
main { max-width: 1100px; margin: 0 auto; padding: 28px 20px 64px; }
h1 { font-size: 1.5rem; margin: 0 0 4px; }
h2 { font-size: 1.1rem; margin: 0 0 10px; }
h3 { font-size: 0.95rem; margin: 16px 0 8px; color: var(--muted); }
p, td, th, label { font-size: 0.95rem; }
.sub { color: var(--muted); margin: 0 0 20px; }
.ok { background: #e6f4ef; border: 1px solid #b7d9c9; padding: 10px 12px; border-radius: 8px; }
.err { background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; padding: 10px 12px; border-radius: 8px; }
section { background: #fff; border: 1px solid var(--line); border-radius: 12px; padding: 16px 18px; margin-bottom: 16px; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { color: var(--muted); font-weight: 600; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.03em; }
input, button, select, textarea { font: inherit; padding: 8px 10px; border-radius: 8px; border: 1px solid #ccc; }
button { background: var(--accent); color: #fff; border-color: var(--accent); cursor: pointer; }
button.ghost { background: #fff; color: var(--ink); border-color: #ccc; }
button.danger { background: #991b1b; border-color: #991b1b; }
button.sm { padding: 4px 8px; font-size: 0.8rem; }
.row { display: flex; flex-wrap: wrap; gap: 8px; align-items: end; }
.row label { display: flex; flex-direction: column; gap: 4px; }
code { font-size: 0.85em; }
.nav { display: flex; flex-wrap: wrap; gap: 8px; margin: 16px 0 20px; align-items: center; }
.nav a { text-decoration: none; color: var(--ink); padding: 6px 12px; border-radius: 999px; border: 1px solid var(--line); background: #fff; font-size: 0.9rem; }
.nav a.on { background: var(--accent); color: #fff; border-color: var(--accent); }
.nav .spacer { flex: 1; }
.kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px; margin-bottom: 8px; }
.kpi { background: #fff; border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; }
.kpi .n { font-size: 1.6rem; font-weight: 650; letter-spacing: -0.02em; }
.kpi .l { color: var(--muted); font-size: 0.8rem; margin-top: 2px; }
.badge { display: inline-block; font-size: 0.75rem; padding: 2px 8px; border-radius: 999px; background: #eee; }
.badge.new { background: #fef3c7; }
.badge.invited { background: #dbeafe; }
.badge.active { background: #d1fae5; }
.badge.paused { background: #fde68a; }
.badge.declined, .badge.spam, .badge.deleted { background: #fee2e2; }
.badge.ok { background: #d1fae5; }
.badge.warn { background: #fef3c7; color: #92400e; }
.badge.off { background: #f3f4f6; color: #6b7280; }
.actions form { display: inline; margin-right: 4px; }
.muted { color: var(--muted); font-size: 0.85rem; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
@media (max-width: 720px) { .grid2 { grid-template-columns: 1fr; } }
.drawer { border: 2px solid var(--accent); border-radius: 12px; padding: 16px; margin-bottom: 16px; background: #f0fdf4; }
.drawer-head { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin-bottom: 12px; }
.drawer-head h2 { margin: 0; flex: 1; }
.chat { max-height: 320px; overflow-y: auto; background: #fafaf9; border: 1px solid var(--line); border-radius: 8px; padding: 10px; font-size: 0.85rem; }
.chat .line { margin: 4px 0; }
.chat .in { color: #1e40af; }
.chat .out { color: #065f46; }
.bar-row { display: flex; align-items: center; gap: 8px; margin: 4px 0; font-size: 0.8rem; }
.bar-row .lbl { width: 72px; color: var(--muted); }
.bar-row .bar { flex: 1; height: 8px; background: #eee; border-radius: 4px; overflow: hidden; }
.bar-row .fill { height: 100%; background: var(--accent); border-radius: 4px; }
.bar-row .num { width: 36px; text-align: right; }
`;

function fmtWhen(d: Date | null | undefined): string {
  if (!d) return "—";
  return d.toISOString().slice(0, 16).replace("T", " ");
}

function relWhen(d: Date | null | undefined): string {
  if (!d) return "never";
  const ms = Date.now() - d.getTime();
  if (ms < 3600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

function capBadge(pct: number, exempt: boolean): string {
  if (exempt) return `<span class="badge ok">exempt</span>`;
  if (pct >= 100) return `<span class="badge warn">${pct}%</span>`;
  if (pct >= 75) return `<span class="badge warn">${pct}%</span>`;
  return `<span class="muted">${pct}%</span>`;
}

function shell(opts: {
  title: string;
  email?: string | null;
  tab?: string;
  body: string;
  flash?: string;
  error?: string;
}): string {
  const tabs = [
    ["overview", "Overview"],
    ["requests", "Requests"],
    ["users", "Users"],
    ["invites", "Invites"],
    ["usage", "Usage"],
    ["quality", "Quality"],
    ["system", "System"],
  ];
  const nav = opts.email
    ? `<nav class="nav">
        ${tabs
          .map(
            ([id, label]) =>
              `<a class="${opts.tab === id ? "on" : ""}" href="/admin?tab=${id}">${label}</a>`,
          )
          .join("")}
        <span class="spacer"></span>
        <span class="muted">${escapeHtml(opts.email)}</span>
        <form method="post" action="/admin/logout" style="display:inline"><button class="ghost" type="submit">Log out</button></form>
      </nav>`
    : "";
  const flash = opts.flash ? `<p class="ok">${escapeHtml(opts.flash)}</p>` : "";
  const err = opts.error ? `<p class="err">${escapeHtml(opts.error)}</p>` : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(opts.title)}</title>
  <style>${CSS}</style>
</head>
<body>
<main>
  <h1>Amilo admin</h1>
  <p class="sub">Beta ops — users, funnel, briefs, workers.</p>
  ${nav}
  ${flash}
  ${err}
  ${opts.body}
</main>
</body>
</html>`;
}

export function renderAdminLogin(opts: { error?: string; emailHint?: string }): string {
  return shell({
    title: "Amilo admin — login",
    ...(opts.error ? { error: opts.error } : {}),
    body: `<section style="max-width:420px">
      <h2>Sign in</h2>
      <p class="sub">Founder access only.</p>
      <form method="post" action="/admin/login" class="row" style="flex-direction:column;align-items:stretch">
        <label>Email
          <input name="email" type="email" required autocomplete="username"
            value="${escapeHtml(opts.emailHint ?? "sameep@speedstar.ai")}" />
        </label>
        <label>Password
          <input name="password" type="password" required autocomplete="current-password" />
        </label>
        <button type="submit">Log in</button>
      </form>
    </section>`,
  });
}

function requestRowsHtml(
  rows: AccessRequestRow[],
  publicBaseUrl: string,
  inviteTokenById: Map<string, string>,
): string {
  if (!rows.length) return "<tr><td colspan=5>No requests yet.</td></tr>";
  return rows
    .map((r) => {
      const when = fmtWhen(r.createdAt);
      const detail = [r.source, r.detail].filter(Boolean).join(" — ");
      const token = r.inviteId ? inviteTokenById.get(r.inviteId) : undefined;
      const inviteLink = token
        ? `<a href="${escapeHtml(`${publicBaseUrl}/i/${token}`)}" target="_blank">invite</a>`
        : "";
      const approve =
        r.status === "new"
          ? `<form class="actions" method="post" action="/admin/requests/approve">
              <input type="hidden" name="id" value="${escapeHtml(r.id)}" />
              <button type="submit">Approve</button>
            </form>`
          : "";
      const decline =
        r.status === "new"
          ? `<form class="actions" method="post" action="/admin/requests/decline">
              <input type="hidden" name="id" value="${escapeHtml(r.id)}" />
              <button class="ghost" type="submit">Decline</button>
            </form>
            <form class="actions" method="post" action="/admin/requests/spam">
              <input type="hidden" name="id" value="${escapeHtml(r.id)}" />
              <button class="danger" type="submit">Spam</button>
            </form>`
          : "";
      return `<tr>
        <td><span class="badge ${escapeHtml(r.status)}">${escapeHtml(r.status)}</span><br><span class="muted">${when}</span></td>
        <td>${escapeHtml(r.name)}<br><span class="muted">${escapeHtml(r.email)}</span></td>
        <td><code>${escapeHtml(r.phoneE164)}</code></td>
        <td>${escapeHtml(detail || "—")}</td>
        <td>${approve}${decline}${inviteLink}</td>
      </tr>`;
    })
    .join("\n");
}

function userTableRow(u: AdminUserRow): string {
  const google = u.googleLinked
    ? `<span class="badge ok">${escapeHtml(u.googleEmails[0] ?? "linked")}</span><br><span class="muted">${relWhen(u.googleLastSync)}</span>`
    : `<span class="badge off">none</span>`;
  return `<tr>
    <td><a href="/admin?tab=users&user=${escapeHtml(u.id)}">${escapeHtml(u.name ?? "—")}</a><br><code>${escapeHtml(u.phoneE164)}</code></td>
    <td><span class="badge ${escapeHtml(u.status)}">${escapeHtml(u.status)}</span></td>
    <td><span class="muted">${relWhen(u.lastSeen)}</span><br><span class="muted">${fmtWhen(u.lastSeen)}</span></td>
    <td>${google}</td>
    <td>${u.dayUsage}/${u.dayCap} ${capBadge(u.capPctDay, u.capExempt)}<br>${u.weekUsage}/${u.weekCap} ${capBadge(u.capPctWeek, u.capExempt)}</td>
    <td>${formatUsdFromMicros(u.weekCostMicros)}</td>
    <td><a href="/admin?tab=users&user=${escapeHtml(u.id)}">Inspect</a></td>
  </tr>`;
}

function renderUserDrawer(detail: AdminUserInspect): string {
  const u = detail.user;
  const chatHtml = detail.chat.length
    ? [...detail.chat]
        .reverse()
        .map((c) => {
          const who = c.direction === "in" ? "User" : "Amilo";
          const cls = c.direction === "in" ? "in" : "out";
          const body = escapeHtml((c.bodyRef ?? `[${c.kind}]`).slice(0, 400));
          return `<div class="line ${cls}"><span class="muted">${fmtWhen(c.ts).slice(11)}</span> <strong>${who}</strong>: ${body}</div>`;
        })
        .join("")
    : `<p class="muted">No messages yet.</p>`;

  const commits = detail.commitments.length
    ? `<ul>${detail.commitments
        .map(
          (c) =>
            `<li>${escapeHtml(c.title)}${c.dueAt ? ` <span class="muted">due ${fmtWhen(c.dueAt)}</span>` : ""}</li>`,
        )
        .join("")}</ul>`
    : `<p class="muted">No open commitments.</p>`;

  const pending = detail.pending
    ? `<p><strong>${escapeHtml(detail.pending.kind)}</strong>: ${escapeHtml(detail.pending.summary)}<br>
       <span class="muted">expires ${fmtWhen(detail.pending.expiresAt)}</span></p>`
    : `<p class="muted">Nothing pending confirm.</p>`;

  const watches = detail.openWatches.length
    ? `<ul>${detail.openWatches
        .map((w) => `<li><code>${escapeHtml(w.kind)}</code> ${escapeHtml(w.title)}</li>`)
        .join("")}</ul>`
    : `<p class="muted">No open watches.</p>`;

  const google = detail.googleAccounts.length
    ? detail.googleAccounts
        .map(
          (g) =>
            `<span class="badge ok">${escapeHtml(g.label)}</span> ${escapeHtml(g.email ?? "—")} <span class="muted">sync ${relWhen(g.lastSyncAt)}</span>`,
        )
        .join("<br>")
    : `<span class="badge off">Not connected</span>`;

  const statusBtn =
    u.status === "active"
      ? `<form method="post" action="/admin/users/${escapeHtml(u.id)}/pause" style="display:inline"><button class="ghost sm" type="submit">Pause</button></form>`
      : `<form method="post" action="/admin/users/${escapeHtml(u.id)}/resume" style="display:inline"><button class="ghost sm" type="submit">Resume</button></form>`;

  return `<div class="drawer">
    <div class="drawer-head">
      <h2>${escapeHtml(u.name ?? u.phoneE164)}</h2>
      <a class="ghost sm" href="/admin?tab=users" style="padding:6px 12px;border-radius:8px;text-decoration:none;border:1px solid #ccc">Close</a>
      ${statusBtn}
      <form method="post" action="/admin/users/${escapeHtml(u.id)}/sync" style="display:inline">
        <button class="sm" type="submit">Force Google sync</button>
      </form>
    </div>
    <div class="grid2">
      <div>
        <p class="muted"><code>${escapeHtml(u.phoneE164)}</code> · ${escapeHtml(u.timezone)} · joined ${fmtWhen(u.createdAt)}</p>
        <p>Last seen: <strong>${relWhen(detail.lastSeen)}</strong> · Google: ${google}</p>
        <p>Usage today ${detail.dayUsage} · week ${detail.weekUsage} · cost ${formatUsdFromMicros(detail.weekCostMicros)}${detail.capExempt ? ' · <span class="badge ok">cap exempt</span>' : ""}</p>
      </div>
      <div>
        <h3>Open commitments</h3>${commits}
        <h3>Pending confirm</h3>${pending}
        <h3>Open watches</h3>${watches}
      </div>
    </div>
    <h3>Recent chat (WhatsApp)</h3>
    <div class="chat">${chatHtml}</div>
  </div>`;
}

function miniBarChart(rows: Array<{ label: string; value: number }>, max?: number): string {
  const top = max ?? Math.max(1, ...rows.map((r) => r.value));
  return rows
    .map((r) => {
      const pct = Math.round((r.value / top) * 100);
      return `<div class="bar-row"><span class="lbl">${escapeHtml(r.label)}</span><div class="bar"><div class="fill" style="width:${pct}%"></div></div><span class="num">${r.value}</span></div>`;
    })
    .join("");
}

export async function renderAdminDashboard(opts: {
  db: Db;
  publicBaseUrl: string;
  email: string;
  tab?: string;
  userId?: string;
  message?: string;
  error?: string;
  usageDayCap: number;
  usageWeekCap: number;
  usageCapExemptPhones: string[];
  gitSha?: string;
  workerStatuses?: WorkerHeartbeat[];
}): Promise<string> {
  const tab = opts.tab || "overview";
  const stats = await getOnboardingStats(opts.db);
  const conversion =
    stats.requestsTotal > 0
      ? `${Math.round((stats.activeUsers / stats.requestsTotal) * 100)}%`
      : "—";

  const kpiBlock = `<div class="kpis">
    <div class="kpi"><div class="n">${stats.requestsTotal}</div><div class="l">Requests</div></div>
    <div class="kpi"><div class="n">${stats.requestsPending}</div><div class="l">Pending</div></div>
    <div class="kpi"><div class="n">${stats.requestsThisWeek}</div><div class="l">This week</div></div>
    <div class="kpi"><div class="n">${stats.activeUsers}</div><div class="l">Active users</div></div>
    <div class="kpi"><div class="n">${conversion}</div><div class="l">Active / requests</div></div>
  </div>`;

  let body = "";
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600_000);
  const caps = { day: opts.usageDayCap, week: opts.usageWeekCap };

  if (tab === "overview") {
    const inviteSummary = await countInvitesSummary(opts.db);
    body = `<section>
      <h2>Pipeline</h2>
      ${kpiBlock}
      <p class="muted">Pending ${stats.requestsPending} · Invited ${stats.requestsInvited} · Active ${stats.requestsActive} · Declined/spam ${stats.requestsDeclined}</p>
      <p class="muted">Invites: ${inviteSummary.total} total · ${inviteSummary.open} open · ${inviteSummary.totalUses} claims</p>
      <p class="sub" style="margin-top:12px">Website form → <code>POST ${escapeHtml(opts.publicBaseUrl)}/access-requests</code></p>
    </section>`;
  } else if (tab === "requests") {
    const rows = await listAccessRequests(opts.db, { limit: 100 });
    const invites = await listInvites(opts.db);
    const inviteTokenById = new Map(invites.map((i) => [i.id, i.token]));
    body = `<section>
      <h2>Access requests</h2>
      ${kpiBlock}
      <p class="sub">Approve allowlists the phone and creates an invite link.</p>
      <table>
        <thead><tr><th>Status</th><th>Person</th><th>WhatsApp</th><th>Source / note</th><th></th></tr></thead>
        <tbody>${requestRowsHtml(rows, opts.publicBaseUrl, inviteTokenById)}</tbody>
      </table>
    </section>`;
  } else if (tab === "users") {
    const adminUsers = await listUsersForAdmin(opts.db, {
      caps,
      exemptPhones: opts.usageCapExemptPhones,
    });
    const phones = await listAllowedPhones(opts.db);
    let drawer = "";
    if (opts.userId) {
      const detail = await getUserInspect(opts.db, opts.userId, {
        exemptPhones: opts.usageCapExemptPhones,
      });
      if (detail) drawer = renderUserDrawer(detail);
    }
    const userRows =
      adminUsers.map(userTableRow).join("\n") ||
      "<tr><td colspan=7>No registered users yet — they appear after first WhatsApp message.</td></tr>";
    const phoneRows = phones
      .map(
        (p) => `<tr>
      <td>${escapeHtml(p.phoneE164)}</td>
      <td>${escapeHtml(p.label ?? "")}</td>
      <td>${p.active ? "active" : "off"}</td>
      <td>
        <form method="post" action="/admin/phones/remove" style="display:inline">
          <input type="hidden" name="phone" value="${escapeHtml(p.phoneE164)}" />
          <button class="ghost sm" type="submit">Disable</button>
        </form>
      </td>
    </tr>`,
      )
      .join("\n");
    body = `${drawer}<section>
      <h2>Users (${adminUsers.length})</h2>
      <p class="sub">Registered WhatsApp users — status, last seen, Google, usage caps, cost (7d).</p>
      <table>
        <thead><tr><th>User</th><th>Status</th><th>Last seen</th><th>Google</th><th>Caps day/week</th><th>7d cost</th><th></th></tr></thead>
        <tbody>${userRows}</tbody>
      </table>
    </section>
    <section>
      <h2>Allowlist</h2>
      <form method="post" action="/admin/phones/add" class="row">
        <label>Phone (E.164)<input name="phone" placeholder="+9198XXXXXXXX" required /></label>
        <label>Label<input name="label" placeholder="Friend name" /></label>
        <button type="submit">Add</button>
      </form>
      <table>
        <thead><tr><th>Phone</th><th>Label</th><th>Status</th><th></th></tr></thead>
        <tbody>${phoneRows || "<tr><td colspan=4>None yet.</td></tr>"}</tbody>
      </table>
    </section>`;
  } else if (tab === "invites") {
    const inviteRows = await listInvites(opts.db);
    const inviteList = inviteRows
      .map((i) => {
        const url = `${opts.publicBaseUrl}/i/${i.token}`;
        const open = inviteIsOpen(i);
        return `<tr>
        <td><code>${escapeHtml(i.token)}</code></td>
        <td>${escapeHtml(i.phoneE164 ?? "—")}</td>
        <td>${escapeHtml(i.label ?? "")}</td>
        <td>${i.useCount}/${i.maxUses} ${open ? "" : "(closed)"}</td>
        <td><a href="${escapeHtml(url)}" target="_blank">link</a> · <a href="${escapeHtml(url)}/qr" target="_blank">QR</a></td>
      </tr>`;
      })
      .join("\n");
    body = `<section>
      <h2>Invite link / QR</h2>
      <form method="post" action="/admin/invites/create" class="row">
        <label>Phone (optional)<input name="phone" placeholder="+91…" /></label>
        <label>Label<input name="label" placeholder="Priya beta" /></label>
        <label>Max uses<input name="maxUses" type="number" value="1" min="1" max="50" /></label>
        <button type="submit">Create invite</button>
      </form>
      <table>
        <thead><tr><th>Token</th><th>Phone</th><th>Label</th><th>Uses</th><th>Share</th></tr></thead>
        <tbody>${inviteList || "<tr><td colspan=5>No invites yet.</td></tr>"}</tbody>
      </table>
    </section>`;
  } else if (tab === "usage") {
    const funnel = await getInviteFunnelByDay(opts.db, 14);
    const byKind = await listUsageByKindDay(opts.db, weekAgo);
    const usage = await listUsageByUser(opts.db, weekAgo);

    const kindTotals = new Map<string, number>();
    for (const r of byKind) {
      kindTotals.set(r.kind, (kindTotals.get(r.kind) ?? 0) + r.units);
    }
    const kindBars = miniBarChart(
      [...kindTotals.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([label, value]) => ({ label, value })),
    );

    const funnelRows = funnel
      .map(
        (f) => `<tr>
        <td>${escapeHtml(f.day)}</td>
        <td>${f.requests}</td>
        <td>${f.invited}</td>
        <td>${f.newUsers}</td>
      </tr>`,
      )
      .join("\n");

    const kindDayMap = new Map<string, Map<string, number>>();
    for (const r of byKind) {
      if (!kindDayMap.has(r.day)) kindDayMap.set(r.day, new Map());
      kindDayMap.get(r.day)!.set(r.kind, r.units);
    }
    const kinds = [...kindTotals.keys()].sort();
    const kindDayRows = [...kindDayMap.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .slice(0, 14)
      .map(([day, km]) => {
        const cells = kinds.map((k) => `<td>${km.get(k) ?? 0}</td>`).join("");
        return `<tr><td>${escapeHtml(day)}</td>${cells}</tr>`;
      })
      .join("\n");

    const usageRows = usage
      .map(
        (u) => `<tr>
      <td>${escapeHtml(u.name ?? "—")}</td>
      <td>${escapeHtml(u.phone ?? u.userId?.slice(0, 8) ?? "—")}</td>
      <td>${u.interactions}</td>
      <td>${formatUsdFromMicros(u.costMicros)}</td>
    </tr>`,
      )
      .join("\n");

    body = `<section>
      <h2>Invite funnel (14 days)</h2>
      <table>
        <thead><tr><th>Day</th><th>New requests</th><th>Invited</th><th>New users</th></tr></thead>
        <tbody>${funnelRows || "<tr><td colspan=4>No data yet.</td></tr>"}</tbody>
      </table>
    </section>
    <section>
      <h2>Usage by kind (7 days)</h2>
      ${kindBars}
      ${
        kinds.length
          ? `<table style="margin-top:12px"><thead><tr><th>Day</th>${kinds.map((k) => `<th>${escapeHtml(k)}</th>`).join("")}</tr></thead><tbody>${kindDayRows}</tbody></table>`
          : `<p class="muted">No usage events yet.</p>`
      }
    </section>
    <section>
      <h2>Per user (7 days)</h2>
      <p class="muted">Caps: ${opts.usageDayCap}/day · ${opts.usageWeekCap}/week</p>
      <table>
        <thead><tr><th>Name</th><th>Phone</th><th>Interactions</th><th>~Cost</th></tr></thead>
        <tbody>${usageRows || "<tr><td colspan=4>No usage yet.</td></tr>"}</tbody>
      </table>
    </section>`;
  } else if (tab === "quality") {
    const brief = await getBriefQualityStats(opts.db, weekAgo);
    const watch = await getWatcherQualityStats(opts.db, weekAgo);
    const briefBars = miniBarChart(brief.byDay.slice(0, 7).map((d) => ({ label: d.day.slice(5), value: d.count })));
    const openWatchKinds = miniBarChart(
      Object.entries(watch.byKindOpen).map(([label, value]) => ({ label, value })),
    );
    const firedKinds = miniBarChart(
      Object.entries(watch.byKindFiredWeek).map(([label, value]) => ({ label, value })),
    );

    body = `<section>
      <h2>Brief quality (7 days)</h2>
      <div class="kpis">
        <div class="kpi"><div class="n">${brief.total}</div><div class="l">Briefs sent</div></div>
        <div class="kpi"><div class="n">${brief.morning}</div><div class="l">Morning</div></div>
        <div class="kpi"><div class="n">${brief.evening}</div><div class="l">Evening</div></div>
        <div class="kpi"><div class="n">${brief.avgPriorities}</div><div class="l">Avg priorities</div></div>
        <div class="kpi"><div class="n">${brief.freeFormRate}%</div><div class="l">Free-form (24h)</div></div>
      </div>
      <h3>By day</h3>
      ${briefBars || `<p class="muted">No briefs logged yet.</p>`}
    </section>
    <section>
      <h2>Watchers (7 days)</h2>
      <div class="kpis">
        <div class="kpi"><div class="n">${watch.open}</div><div class="l">Open now</div></div>
        <div class="kpi"><div class="n">${watch.firedWeek}</div><div class="l">Fired</div></div>
        <div class="kpi"><div class="n">${watch.alertsWeek}</div><div class="l">Alerts pushed</div></div>
        <div class="kpi"><div class="n">${watch.cancelledWeek}</div><div class="l">Cancelled</div></div>
      </div>
      <div class="grid2">
        <div><h3>Open by kind</h3>${openWatchKinds || `<p class="muted">None open.</p>`}</div>
        <div><h3>Fired by kind</h3>${firedKinds || `<p class="muted">None fired this week.</p>`}</div>
      </div>
    </section>`;
  } else if (tab === "system") {
    const workers = opts.workerStatuses ?? [];
    const workerRows = workers.length
      ? workers
          .map((w) => {
            const ok = w.lastOkAt && (!w.lastErrorAt || w.lastOkAt > w.lastErrorAt);
            const badge = w.running
              ? `<span class="badge invited">running</span>`
              : ok
                ? `<span class="badge ok">ok</span>`
                : w.lastErrorAt
                  ? `<span class="badge warn">error</span>`
                  : `<span class="badge off">idle</span>`;
            return `<tr>
          <td><strong>${escapeHtml(w.name)}</strong><br><span class="muted">every ${Math.round(w.intervalMs / 1000)}s</span></td>
          <td>${badge}</td>
          <td><span class="muted">${w.lastTickAt ? relWhen(new Date(w.lastTickAt)) : "—"}</span></td>
          <td><span class="muted">${w.lastOkAt ? relWhen(new Date(w.lastOkAt)) : "—"}</span></td>
          <td>${w.lastError ? `<span class="muted">${escapeHtml(w.lastError.slice(0, 80))}</span>` : "—"}</td>
        </tr>`;
          })
          .join("\n")
      : "<tr><td colspan=5>No workers registered.</td></tr>";

    body = `<section>
      <h2>Deploy</h2>
      <p>Git SHA: <code>${escapeHtml(opts.gitSha ?? "unknown")}</code></p>
      <p class="muted"><a href="/health" target="_blank">/health</a> JSON includes sha + worker summary.</p>
    </section>
    <section>
      <h2>Background workers</h2>
      <table>
        <thead><tr><th>Worker</th><th>Status</th><th>Last tick</th><th>Last ok</th><th>Last error</th></tr></thead>
        <tbody>${workerRows}</tbody>
      </table>
    </section>`;
  } else {
    body = `<section><p>Unknown tab.</p></section>`;
  }

  return shell({
    title: "Amilo admin",
    email: opts.email,
    tab,
    ...(opts.message ? { flash: opts.message } : {}),
    ...(opts.error ? { error: opts.error } : {}),
    body,
  });
}

export function renderInvitePage(opts: {
  token: string;
  publicBaseUrl: string;
  waDisplayPhone: string;
  invitePhone: string | null;
  open: boolean;
  error?: string;
  claimedWaUrl?: string;
}): string {
  const claimUrl = `${opts.publicBaseUrl}/i/${opts.token}`;
  const qrUrl = `${claimUrl}/qr`;
  const needsPhone = !opts.invitePhone;
  const waUrl =
    opts.claimedWaUrl ??
    (opts.invitePhone || opts.waDisplayPhone
      ? waMeUrl(opts.waDisplayPhone, "Hi Amilo")
      : "#");

  if (!opts.open && !opts.claimedWaUrl) {
    return pageShell(
      "Invite closed",
      `<h1>This invite is closed</h1><p>Ask the host for a new link.</p>`,
    );
  }

  const err = opts.error ? `<p class="err">${escapeHtml(opts.error)}</p>` : "";

  const form = needsPhone
    ? `<form method="post" action="${escapeHtml(claimUrl)}" class="stack">
        <label>Your WhatsApp number
          <input name="phone" placeholder="+9198XXXXXXXX" required inputmode="tel" />
        </label>
        <button type="submit">Continue to WhatsApp</button>
      </form>`
    : `<p><a class="btn" href="${escapeHtml(waUrl)}">Open WhatsApp</a></p>
       <p class="muted">Or scan the QR below.</p>
       <img class="qr" src="${escapeHtml(qrUrl)}" alt="QR code to open WhatsApp" width="200" height="200" />`;

  return pageShell(
    "Join Amilo",
    `<h1>Join Amilo</h1>
     <p class="muted">Your chief of staff on WhatsApp — beta invite.</p>
     ${err}
     ${form}
     ${
       needsPhone
         ? ""
         : `<p class="muted">After WhatsApp opens, send the prefilled hello. Then: connect google personal.</p>`
     }`,
  );
}

function pageShell(title: string, body: string): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 0; background: #0f1410; color: #f2efe8; }
  main { max-width: 420px; margin: 0 auto; padding: 48px 20px; text-align: center; }
  h1 { font-size: 1.75rem; margin: 0 0 8px; letter-spacing: -0.02em; }
  .muted { color: #a8a29a; }
  .err { color: #fecaca; background: #450a0a; padding: 10px; border-radius: 8px; }
  .btn, button { display: inline-block; background: #d9f99d; color: #14532d; text-decoration: none;
    font-weight: 600; padding: 14px 22px; border-radius: 999px; border: 0; font: inherit; cursor: pointer; }
  input { width: 100%; box-sizing: border-box; padding: 12px; border-radius: 10px; border: 1px solid #444; background: #1c1917; color: #fff; margin-top: 6px; }
  .stack { display: flex; flex-direction: column; gap: 12px; text-align: left; }
  .qr { background: #fff; padding: 12px; border-radius: 12px; margin-top: 12px; }
</style></head><body><main>${body}</main></body></html>`;
}

export async function buildQrPngDataUrl(text: string): Promise<Buffer> {
  try {
    const QR = await import("qrcode");
    return await QR.toBuffer(text, { type: "png", width: 280, margin: 2 });
  } catch {
    return Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
  }
}

export {
  claimInvite,
  createInvite,
  addAllowedPhone,
  deactivateAllowedPhone,
  getInviteByToken,
  waMeUrl,
};
