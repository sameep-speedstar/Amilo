import type { Context } from "hono";
import type { Db } from "@amilo/db";
import {
  addAllowedPhone,
  claimInvite,
  createInvite,
  deactivateAllowedPhone,
  formatUsdFromMicros,
  getInviteByToken,
  inviteIsOpen,
  listAllowedPhones,
  listInvites,
  listUsageByUser,
  waMeUrl,
} from "@amilo/db";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Minimal QR as Google Chart-free: use SVG via qrserver-compatible path on our host later.
 * For beta we embed an img to a same-origin /qr endpoint that draws via a tiny matrix.
 */
export function adminAuthOk(c: Context, adminToken: string): boolean {
  if (!adminToken) return false;
  const hdr = c.req.header("x-admin-token") ?? "";
  const q = c.req.query("token") ?? "";
  const cookie = parseCookie(c.req.header("cookie") ?? "").admin_token ?? "";
  return hdr === adminToken || q === adminToken || cookie === adminToken;
}

function parseCookie(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of raw.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (!k) continue;
    out[k] = decodeURIComponent(rest.join("=") || "");
  }
  return out;
}

export function setAdminCookie(token: string): string {
  return `admin_token=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`;
}

export async function renderAdminDashboard(opts: {
  db: Db;
  publicBaseUrl: string;
  adminToken: string;
  message?: string;
}): Promise<string> {
  const phones = await listAllowedPhones(opts.db);
  const inviteRows = await listInvites(opts.db);
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600_000);
  const usage = await listUsageByUser(opts.db, weekAgo);

  const phoneRows = phones
    .map(
      (p) => `<tr>
      <td>${escapeHtml(p.phoneE164)}</td>
      <td>${escapeHtml(p.label ?? "")}</td>
      <td>${p.active ? "active" : "off"}</td>
      <td>
        <form method="post" action="/admin/phones/remove" style="display:inline">
          <input type="hidden" name="token" value="${escapeHtml(opts.adminToken)}" />
          <input type="hidden" name="phone" value="${escapeHtml(p.phoneE164)}" />
          <button type="submit">Disable</button>
        </form>
      </td>
    </tr>`,
    )
    .join("\n");

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

  const flash = opts.message
    ? `<p class="ok">${escapeHtml(opts.message)}</p>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Amilo admin — beta</title>
  <style>
    :root { color-scheme: light; --ink:#1a1a1a; --muted:#666; --line:#e5e5e5; --accent:#0b6e4f; }
    body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 0; background: #f7f6f2; color: var(--ink); }
    main { max-width: 920px; margin: 0 auto; padding: 28px 20px 64px; }
    h1 { font-size: 1.5rem; margin: 0 0 4px; }
    h2 { font-size: 1.1rem; margin: 28px 0 10px; }
    p, td, th, label { font-size: 0.95rem; }
    .sub { color: var(--muted); margin: 0 0 20px; }
    .ok { background: #e6f4ef; border: 1px solid #b7d9c9; padding: 10px 12px; border-radius: 8px; }
    section { background: #fff; border: 1px solid var(--line); border-radius: 12px; padding: 16px 18px; margin-bottom: 16px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid var(--line); vertical-align: top; }
    th { color: var(--muted); font-weight: 600; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.03em; }
    input, button { font: inherit; padding: 8px 10px; border-radius: 8px; border: 1px solid #ccc; }
    button { background: var(--accent); color: #fff; border-color: var(--accent); cursor: pointer; }
    .row { display: flex; flex-wrap: wrap; gap: 8px; align-items: end; }
    .row label { display: flex; flex-direction: column; gap: 4px; }
    code { font-size: 0.85em; }
  </style>
</head>
<body>
<main>
  <h1>Amilo beta admin</h1>
  <p class="sub">Allowlist phones, create invite QR/links, watch weekly usage.</p>
  ${flash}

  <section>
    <h2>Add phone to allowlist</h2>
    <form method="post" action="/admin/phones/add" class="row">
      <input type="hidden" name="token" value="${escapeHtml(opts.adminToken)}" />
      <label>Phone (E.164)<input name="phone" placeholder="+9198XXXXXXXX" required /></label>
      <label>Label<input name="label" placeholder="Friend name" /></label>
      <button type="submit">Add</button>
    </form>
    <table>
      <thead><tr><th>Phone</th><th>Label</th><th>Status</th><th></th></tr></thead>
      <tbody>${phoneRows || "<tr><td colspan=4>None yet (env ALLOWED_PHONES still works).</td></tr>"}</tbody>
    </table>
  </section>

  <section>
    <h2>Invite link / QR</h2>
    <p class="sub">Creates a link that opens WhatsApp. If you set a phone, it is allowlisted first. Leave phone blank for self-serve claim (friend enters their number once).</p>
    <form method="post" action="/admin/invites/create" class="row">
      <input type="hidden" name="token" value="${escapeHtml(opts.adminToken)}" />
      <label>Phone (optional)<input name="phone" placeholder="+91…" /></label>
      <label>Label<input name="label" placeholder="Priya beta" /></label>
      <label>Max uses<input name="maxUses" type="number" value="1" min="1" max="50" /></label>
      <button type="submit">Create invite</button>
    </form>
    <table>
      <thead><tr><th>Token</th><th>Phone</th><th>Label</th><th>Uses</th><th>Share</th></tr></thead>
      <tbody>${inviteList || "<tr><td colspan=5>No invites yet.</td></tr>"}</tbody>
    </table>
  </section>

  <section>
    <h2>Usage (last 7 days)</h2>
    <p class="sub">Interactions ≈ brain/voice turns. Caps default 40/day · 150/week.</p>
    <table>
      <thead><tr><th>Name</th><th>Phone</th><th>Interactions</th><th>~Cost</th></tr></thead>
      <tbody>${usageRows || "<tr><td colspan=4>No usage yet.</td></tr>"}</tbody>
    </table>
  </section>
</main>
</body>
</html>`;
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

/** Tiny QR: delegate to a data-URL PNG via external-free canvas alternative —
 * for beta we return an SVG that embeds the wa.me URL as a scannable QR using a compact encoder.
 * If encoding fails, fall back to a text link page.
 */
export async function buildQrPngDataUrl(text: string): Promise<Buffer> {
  // Dynamic import so builds without native canvas still work: use `qrcode` package if present.
  try {
    const QR = await import("qrcode");
    return await QR.toBuffer(text, { type: "png", width: 280, margin: 2 });
  } catch {
    // Fallback: 1x1 PNG — invite HTML still has the button.
    return Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
  }
}

export { claimInvite, createInvite, addAllowedPhone, deactivateAllowedPhone, getInviteByToken, waMeUrl };
