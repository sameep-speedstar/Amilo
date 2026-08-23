import type { Context } from "hono";
import type { Db } from "@amilo/db";
import {
  addAllowedPhone,
  claimInvite,
  createInvite,
  deactivateAllowedPhone,
  formatUsdFromMicros,
  getInviteByToken,
  getOnboardingStats,
  inviteIsOpen,
  listAccessRequests,
  listAllowedPhones,
  listInvites,
  listUsageByUser,
  waMeUrl,
  type AccessRequestRow,
} from "@amilo/db";

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

/** Legacy token auth (emergency). Prefer session cookie from email login. */
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
:root { color-scheme: light; --ink:#1a1a1a; --muted:#666; --line:#e5e5e5; --accent:#0b6e4f; --bg:#f7f6f2; }
body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 0; background: var(--bg); color: var(--ink); }
main { max-width: 980px; margin: 0 auto; padding: 28px 20px 64px; }
h1 { font-size: 1.5rem; margin: 0 0 4px; }
h2 { font-size: 1.1rem; margin: 0 0 10px; }
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
.row { display: flex; flex-wrap: wrap; gap: 8px; align-items: end; }
.row label { display: flex; flex-direction: column; gap: 4px; }
code { font-size: 0.85em; }
.nav { display: flex; flex-wrap: wrap; gap: 8px; margin: 16px 0 20px; align-items: center; }
.nav a { text-decoration: none; color: var(--ink); padding: 6px 12px; border-radius: 999px; border: 1px solid var(--line); background: #fff; font-size: 0.9rem; }
.nav a.on { background: var(--accent); color: #fff; border-color: var(--accent); }
.nav .spacer { flex: 1; }
.kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin-bottom: 8px; }
.kpi { background: #fff; border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; }
.kpi .n { font-size: 1.6rem; font-weight: 650; letter-spacing: -0.02em; }
.kpi .l { color: var(--muted); font-size: 0.8rem; margin-top: 2px; }
.badge { display: inline-block; font-size: 0.75rem; padding: 2px 8px; border-radius: 999px; background: #eee; }
.badge.new { background: #fef3c7; }
.badge.invited { background: #dbeafe; }
.badge.active { background: #d1fae5; }
.badge.declined, .badge.spam { background: #fee2e2; }
.actions form { display: inline; margin-right: 4px; }
.muted { color: var(--muted); font-size: 0.85rem; }
`;

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
  <p class="sub">Invite-only beta — requests, users, cost.</p>
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
      const when = r.createdAt.toISOString().slice(0, 16).replace("T", " ");
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

export async function renderAdminDashboard(opts: {
  db: Db;
  publicBaseUrl: string;
  email: string;
  tab?: string;
  message?: string;
  error?: string;
}): Promise<string> {
  const tab = opts.tab || "overview";
  const stats = await getOnboardingStats(opts.db);
  const conversion =
    stats.requestsTotal > 0
      ? `${Math.round((stats.activeUsers / stats.requestsTotal) * 100)}%`
      : "—";

  const kpiBlock = `<div class="kpis">
    <div class="kpi"><div class="n">${stats.requestsTotal}</div><div class="l">Requests received</div></div>
    <div class="kpi"><div class="n">${stats.requestsPending}</div><div class="l">Pending</div></div>
    <div class="kpi"><div class="n">${stats.requestsThisWeek}</div><div class="l">This week</div></div>
    <div class="kpi"><div class="n">${stats.activeUsers}</div><div class="l">Active users</div></div>
    <div class="kpi"><div class="n">${conversion}</div><div class="l">Active / requests</div></div>
  </div>`;

  let body = "";
  if (tab === "overview") {
    body = `<section>
      <h2>Pipeline</h2>
      ${kpiBlock}
      <p class="muted">Pending ${stats.requestsPending} · Invited ${stats.requestsInvited} · From requests marked active ${stats.requestsActive} · Declined/spam ${stats.requestsDeclined}</p>
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
    const phones = await listAllowedPhones(opts.db);
    const phoneRows = phones
      .map(
        (p) => `<tr>
      <td>${escapeHtml(p.phoneE164)}</td>
      <td>${escapeHtml(p.label ?? "")}</td>
      <td>${p.active ? "active" : "off"}</td>
      <td>
        <form method="post" action="/admin/phones/remove" style="display:inline">
          <input type="hidden" name="phone" value="${escapeHtml(p.phoneE164)}" />
          <button class="ghost" type="submit">Disable</button>
        </form>
      </td>
    </tr>`,
      )
      .join("\n");
    body = `<section>
      <h2>Allowlist</h2>
      <p class="sub">Active users (messaged Amilo): <strong>${stats.activeUsers}</strong></p>
      <form method="post" action="/admin/phones/add" class="row">
        <label>Phone (E.164)<input name="phone" placeholder="+9198XXXXXXXX" required /></label>
        <label>Label<input name="label" placeholder="Friend name" /></label>
        <button type="submit">Add</button>
      </form>
      <table>
        <thead><tr><th>Phone</th><th>Label</th><th>Status</th><th></th></tr></thead>
        <tbody>${phoneRows || "<tr><td colspan=4>None yet (env ALLOWED_PHONES still works).</td></tr>"}</tbody>
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
      <p class="sub">Prefer approving a request — or create a one-off invite here.</p>
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
  } else {
    const weekAgo = new Date(Date.now() - 7 * 24 * 3600_000);
    const usage = await listUsageByUser(opts.db, weekAgo);
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
      <h2>Usage (last 7 days)</h2>
      <p class="sub">Interactions ≈ brain/voice turns. Caps default 40/day · 150/week.</p>
      <table>
        <thead><tr><th>Name</th><th>Phone</th><th>Interactions</th><th>~Cost</th></tr></thead>
        <tbody>${usageRows || "<tr><td colspan=4>No usage yet.</td></tr>"}</tbody>
      </table>
    </section>`;
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
