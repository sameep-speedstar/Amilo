export function studioPageHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Studio — Speedstar</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,500;1,9..144,500&family=Albert+Sans:wght@400;500;600&family=Spline+Sans+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
:root { --ink:#12162E; --gold:#F2A93B; --paper:#FBFAF6; --dim:#6E7391; --line:#E7E4DA; --ok:#1F7A4D; --bad:#9B2335; }
* { box-sizing: border-box; }
html, body { margin: 0; min-height: 100%; background: var(--paper); color: var(--ink); font-family: 'Albert Sans', system-ui, sans-serif; }
h1, h2, h3 { font-family: 'Fraunces', serif; font-weight: 500; margin: 0; }
a { color: inherit; }
button, input, textarea, select { font: inherit; }
button { cursor: pointer; }
.top { background: var(--ink); color: var(--paper); padding: 16px 24px; display: flex; align-items: center; gap: 16px; }
.top b { letter-spacing: .16em; font-size: 13px; }
.top span { color: #9AA0BE; font-size: 13px; }
.top a { margin-left: auto; color: var(--gold); font-size: 13px; text-decoration: none; }
.wrap { max-width: 1180px; margin: 0 auto; padding: 24px; }
.row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
.products { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 18px; }
.chip { border: 1px solid var(--line); background: #fff; border-radius: 999px; padding: 7px 14px; }
.chip.on { background: var(--ink); color: #fff; border-color: var(--ink); }
.tabs { display: flex; gap: 6px; margin: 8px 0 18px; flex-wrap: wrap; }
.tabs button { background: transparent; border: 0; border-bottom: 2px solid transparent; padding: 8px 4px; color: var(--dim); }
.tabs button.on { color: var(--ink); border-bottom-color: var(--gold); }
.panel { background: #fff; border: 1px solid var(--line); border-radius: 14px; padding: 18px; }
label { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: var(--dim); }
input, textarea, select { border: 1px solid var(--line); border-radius: 8px; padding: 9px 11px; background: #fff; }
textarea { min-height: 160px; width: 100%; }
.btn { background: var(--ink); color: #fff; border: 0; border-radius: 8px; padding: 9px 14px; }
.btn.gold { background: var(--gold); color: var(--ink); }
.btn.ghost { background: #fff; color: var(--ink); border: 1px solid var(--line); }
.btn.danger { background: var(--bad); }
.muted { color: var(--dim); font-size: 13px; }
.err { color: var(--bad); font-size: 13px; }
.ok { color: var(--ok); font-size: 13px; }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--dim); }
.badge { font-size: 11px; padding: 2px 8px; border-radius: 999px; background: #eee; }
.badge.ready { background: #d1fae5; }
.badge.posted { background: #dbeafe; }
.badge.failed { background: #fee2e2; }
.badge.draft { background: #fef3c7; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
@media (max-width: 800px) { .grid { grid-template-columns: 1fr; } }
.drop { border: 1px dashed var(--dim); border-radius: 12px; padding: 22px; text-align: center; color: var(--dim); }
.thumbs { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
.thumbs img { width: 88px; height: 88px; object-fit: cover; border-radius: 8px; border: 2px solid transparent; }
.thumbs img.on { border-color: var(--gold); }
.phone { width: 280px; background: #0B0B14; border-radius: 28px; padding: 8px; }
.screen { background: #EFE9E1; border-radius: 22px; overflow: hidden; min-height: 360px; display: flex; flex-direction: column; }
.head { background: #1C1B33; color: #fff; padding: 22px 12px 10px; display: flex; gap: 8px; align-items: center; }
.av { width: 28px; height: 28px; border-radius: 50%; background: var(--gold); color: var(--ink); display: grid; place-items: center; font-family: Fraunces, serif; }
.thread { padding: 10px; display: flex; flex-direction: column; gap: 6px; flex: 1; }
.msg { max-width: 86%; padding: 7px 10px; border-radius: 10px; font-size: 13px; line-height: 1.4; white-space: pre-wrap; }
.amilo { align-self: flex-start; background: #fff; }
.user { align-self: flex-end; background: #DCF3D0; }
.hidden { display: none; }
.stack { display: flex; flex-direction: column; gap: 12px; }
.drafts { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }
@media (max-width: 900px) { .drafts { grid-template-columns: 1fr; } }
.draft-card { border: 1px solid var(--line); border-radius: 12px; padding: 12px; background: var(--paper); display: flex; flex-direction: column; gap: 8px; }
.draft-card h3 { font-size: 16px; }
.draft-card pre { white-space: pre-wrap; font-family: 'Albert Sans', sans-serif; font-size: 13px; margin: 0; line-height: 1.45; }
</style>
</head>
<body>
<header class="top">
  <b>STUDIO</b>
  <span>Plans, mockups, handles — then it posts.</span>
  <a href="/admin">Amilo admin</a>
</header>
<div class="wrap">
  <div class="row" style="justify-content:space-between;margin-bottom:12px">
    <h1>Products</h1>
    <button class="btn gold" id="newProduct">Add product</button>
  </div>
  <div class="products" id="products"></div>
  <div id="empty" class="muted">Add Amilo, then the next four. Each product has its own handles.</div>
  <div id="workspace" class="hidden">
    <div class="tabs" id="tabs"></div>
    <div id="main"></div>
  </div>
</div>
<script type="module">
const CHANNELS = [
  { kind: "x", label: "X" },
  { kind: "instagram", label: "Instagram" },
  { kind: "linkedin", label: "LinkedIn" },
];
const FIELDS = {
  x: [
    ["apiKey", "API key", false],
    ["apiSecret", "API secret", true],
    ["accessToken", "Access token", true],
    ["accessSecret", "Access secret", true],
  ],
  instagram: [
    ["userId", "IG user ID", false],
    ["accessToken", "Page access token", true],
  ],
  linkedin: [
    ["accessToken", "Access token", true],
    ["authorUrn", "Author URN (optional — resolved if blank)", false],
  ],
};
const TABS = [
  ["queue", "Queue"],
  ["plan", "Paste plan"],
  ["adhoc", "Ad hoc"],
  ["mockup", "Mockup"],
  ["visuals", "Visuals"],
  ["handles", "Handles"],
];

let products = [];
let product = null;
let tab = "queue";
let posts = [];
let assets = [];
let selectedAssets = new Set();
let adhocIdea = "";
let draftOptions = [];
let mockup = { kicker: "07:00", headline: "One message. Already read.", messages: [{ who: "amilo", text: "3 need you.\\n22 handled quietly.", time: "7:00 am" }] };

const $ = (id) => document.getElementById(id);
async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: "same-origin",
    ...opts,
    headers: { ...(opts.body instanceof FormData ? {} : { "Content-Type": "application/json" }), ...(opts.headers || {}) },
  });
  if (res.status === 401) { location.href = "/admin/login?next=/studio"; throw new Error("auth"); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

async function refresh() {
  const data = await api("/studio/api/products");
  products = data.products;
  if (product) product = products.find(p => p.id === product.id) || products[0] || null;
  else product = products[0] || null;
  render();
  if (product) await loadProduct();
}

async function loadProduct() {
  const [p, a] = await Promise.all([
    api("/studio/api/products/" + product.id + "/posts"),
    api("/studio/api/products/" + product.id + "/assets"),
  ]);
  posts = p.posts;
  assets = a.assets;
  render();
}

function render() {
  $("products").innerHTML = products.map(p =>
    \`<button class="chip \${product && p.id === product.id ? "on" : ""}" data-id="\${p.id}">\${esc(p.name)}</button>\`
  ).join("");
  $("empty").classList.toggle("hidden", products.length > 0 && product);
  $("workspace").classList.toggle("hidden", !product);
  if (!product) return;
  $("tabs").innerHTML = TABS.map(([id, label]) =>
    \`<button class="\${tab === id ? "on" : ""}" data-tab="\${id}">\${label}</button>\`
  ).join("");
  $("main").innerHTML = views[tab]();
  bind();
}

const views = {
  queue() {
    if (!posts.length) return \`<div class="panel muted">No posts yet. Paste a plan or send an ad hoc post.</div>\`;
    return \`<div class="panel">
      <div class="row" style="justify-content:space-between;margin-bottom:12px">
        <h2>Queue</h2>
        <button class="btn" id="armAll">Arm drafts</button>
      </div>
      <table>
        <tr><th>When</th><th>Hook</th><th>Channels</th><th>Status</th><th></th></tr>
        \${posts.map(p => \`<tr>
          <td>\${fmt(p.scheduledAt)}<br><span class="muted">\${p.source}</span></td>
          <td>\${esc(p.hook)}</td>
          <td>\${p.targets.map(t => \`<div><span class="badge \${t.status}">\${t.channelKind} · \${t.status}</span>\${t.error ? \`<div class="err">\${esc(shortErr(t.error))}</div>\` : ""}</div>\`).join("")}</td>
          <td><span class="badge \${p.status}">\${p.status}</span>\${p.error ? \`<div class="err">\${esc(shortErr(p.error))}</div>\` : ""}</td>
          <td>
            \${p.status === "draft" || p.status === "paused" ? \`<button class="btn ghost" data-arm="\${p.id}">Arm</button>\` : ""}
            \${p.status === "ready" || p.status === "posting" ? \`<button class="btn ghost" data-pause="\${p.id}">Pause</button>\` : ""}
            \${p.status === "failed" ? \`<button class="btn ghost" data-retry="\${p.id}">Retry</button>\` : ""}
          </td>
        </tr>\`).join("")}
      </table>
    </div>\`;
  },
  plan() {
    return \`<div class="panel stack">
      <h2>Paste a plan</h2>
      <p class="muted">JSON (the Amilo queue format), markdown headings, or lines like <code>2026-09-21 | x | copy</code>. Same date+time merges into one post across channels.</p>
      <label>Title <input id="planTitle" placeholder="September launch"></label>
      <label>Plan <textarea id="planRaw" placeholder="# 2026-09-21 09:30\\n## x\\nMost things don't deserve your attention.\\n\\n## instagram\\nSame idea, longer caption."></textarea></label>
      <div class="row">
        <button class="btn ghost" id="previewPlan">Preview</button>
        <button class="btn" id="savePlan">Save as drafts</button>
        <button class="btn gold" id="armPlan">Save and arm</button>
      </div>
      <div id="planPreview" class="muted"></div>
    </div>\`;
  },
  adhoc() {
    const ch = (product.channels || []).filter(c => c.configured && c.enabled);
    return \`<div class="panel stack">
      <h2>Ad hoc post</h2>
      <p class="muted">Describe the idea. Studio drafts X and Instagram (hook, body, hashtags). Edit, attach a visual, then post. Instagram needs an image. X text is \$0.015; a URL is \$0.20.</p>
      <label>Idea
        <textarea id="adhocIdea" placeholder="e.g. School pickup isn't on the calendar — Amilo still sees it.">\${esc(adhocIdea)}</textarea>
      </label>
      <div class="row">
        <button class="btn gold" id="suggestDrafts">Suggest drafts</button>
      </div>
      <div id="draftResults"></div>
      <label>Hook <input id="adhocHook" placeholder="Optional short label"></label>
      \${CHANNELS.map(c => \`<label>\${c.label} copy
        <textarea id="copy-\${c.kind}" \${ch.some(x => x.kind === c.kind) ? "" : "placeholder='Connect \${c.label} in Handles first'"}></textarea>
      </label>\`).join("")}
      <label>When
        <input id="adhocWhen" type="datetime-local">
      </label>
      <div class="drop" id="adhocDrop">Drop images or click to attach from Visuals</div>
      <div class="thumbs" id="adhocThumbs">\${assetThumbs()}</div>
      <div class="row">
        <button class="btn gold" id="postNow">Post now</button>
        <button class="btn" id="scheduleAdhoc">Schedule</button>
      </div>
      <div id="adhocMsg"></div>
    </div>\`;
  },
  mockup() {
    return \`<div class="grid">
      <div class="panel stack">
        <h2>WhatsApp mockup</h2>
        <label>Kicker <input id="mkKicker" value="\${esc(mockup.kicker)}"></label>
        <label>Headline <input id="mkHeadline" value="\${esc(mockup.headline)}"></label>
        <div id="mkMsgs"></div>
        <button class="btn ghost" id="addMsg">Add message</button>
        <button class="btn gold" id="saveMockup">Save as visual</button>
        <div id="mkMsg" class="muted"></div>
      </div>
      <div class="panel">
        <div class="phone" id="phone">
          <div class="screen">
            <div class="head"><div class="av">A</div><div><b>Amilo</b><div class="muted" style="color:#8FD48F;font-size:11px">your chief of staff · online</div></div></div>
            <div class="thread" id="thread"></div>
          </div>
        </div>
      </div>
    </div>\`;
  },
  visuals() {
    return \`<div class="panel stack">
      <h2>Visuals</h2>
      <p class="muted">Drop real (redacted) screenshots or mockup captures. Attach them on ad hoc posts or later on a queue row.</p>
      <input type="file" id="filePick" accept="image/*" multiple hidden>
      <div class="drop" id="visDrop">Drop images here</div>
      <div class="thumbs">\${assets.map(a => \`<img src="\${a.url}" title="\${esc(a.filename)}" class="\${selectedAssets.has(a.id) ? "on" : ""}" data-asset="\${a.id}">\`).join("") || "<span class='muted'>None yet</span>"}</div>
    </div>\`;
  },
  handles() {
    const chans = product.channels || [];
    return \`<div class="panel stack">
      <h2>Handles</h2>
      <p class="muted">Keys never come back to the browser. Leave a field blank to keep the stored value. Instagram Explorer tokens die in ~1 hour — exchange for a long-lived Page token before saving.</p>
      \${CHANNELS.map(c => {
        const row = chans.find(x => x.kind === c.kind);
        const fields = FIELDS[c.kind].map(([key, label, secret]) =>
          \`<label>\${label}<input data-kind="\${c.kind}" data-key="\${key}" type="\${secret ? "password" : "text"}" placeholder="\${row && row.configured ? "saved — paste to replace" : ""}"></label>\`
        ).join("");
        return \`<section style="border-top:1px solid var(--line);padding-top:12px">
          <div class="row"><h3>\${c.label}</h3>
            <span class="badge \${row && row.configured ? "ready" : ""}">\${row && row.configured ? "connected" : "empty"}</span>
          </div>
          <label>Handle <input data-kind="\${c.kind}" data-key="handle" value="\${esc(row?.handle || "")}" placeholder="@Amilo_io"></label>
          \${fields}
          <label class="row" style="flex-direction:row;align-items:center;gap:8px">
            <input type="checkbox" data-kind="\${c.kind}" data-key="enabled" \${!row || row.enabled ? "checked" : ""}> Enabled
          </label>
          <button class="btn" data-save-ch="\${c.kind}">Save \${c.label}</button>
        </section>\`;
      }).join("")}
      <div id="handleMsg"></div>
    </div>\`;
  },
};

function assetThumbs() {
  return assets.map(a => \`<img src="\${a.url}" data-asset="\${a.id}" class="\${selectedAssets.has(a.id) ? "on" : ""}">\`).join("");
}
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","'":"&#39;" }[c])); }
function shortErr(s) {
  const m = String(s ?? "").match(/"message":"([^"]+)"/);
  return m ? m[1] : String(s ?? "").slice(0, 220);
}
function fmt(iso) { try { return new Date(iso).toLocaleString(); } catch { return iso; } }

function paintDrafts() {
  const box = $("draftResults");
  if (!box) return;
  if (!draftOptions.length) { box.innerHTML = ""; return; }
  box.innerHTML = '<div class="drafts">' + draftOptions.map((o, i) => \`
    <article class="draft-card">
      <h3>\${esc(o.label || o.hook)}</h3>
      <div class="muted">X</div>
      <pre>\${esc(o.x?.copy || "")}</pre>
      <div class="muted">Instagram</div>
      <pre>\${esc(o.instagram?.copy || "")}</pre>
      <button class="btn" data-use-draft="\${i}">Use this</button>
    </article>\`).join("") + "</div>";
  box.querySelectorAll("[data-use-draft]").forEach(b => b.onclick = () => {
    const o = draftOptions[Number(b.dataset.useDraft)];
    if (!o) return;
    const hook = $("adhocHook");
    const x = $("copy-x");
    const ig = $("copy-instagram");
    if (hook) hook.value = o.hook || o.x?.hook || o.label || "";
    if (x) x.value = o.x?.copy || "";
    if (ig) ig.value = o.instagram?.copy || "";
    const msg = $("adhocMsg");
    if (msg) msg.innerHTML = '<span class="ok">Loaded into the copy fields — edit, attach a visual, then post.</span>';
  });
}

function paintMockup() {
  const thread = $("thread");
  if (!thread) return;
  thread.innerHTML = mockup.messages.map(m =>
    \`<div class="msg \${m.who}">\${esc(m.text)}<div class="muted">\${esc(m.time || "")}</div></div>\`
  ).join("");
  const box = $("mkMsgs");
  if (!box) return;
  box.innerHTML = mockup.messages.map((m, i) =>
    \`<div class="row">
      <select data-mi="\${i}" data-f="who"><option \${m.who==="amilo"?"selected":""}>amilo</option><option \${m.who==="user"?"selected":""}>user</option></select>
      <input data-mi="\${i}" data-f="time" value="\${esc(m.time || "")}" style="width:90px">
      <input data-mi="\${i}" data-f="text" value="\${esc(m.text || "")}" style="flex:1">
    </div>\`
  ).join("");
}

function bind() {
  $("products").onclick = (e) => {
    const id = e.target.dataset.id;
    if (!id) return;
    product = products.find(p => p.id === id);
    tab = "queue";
    loadProduct();
  };
  $("tabs").onclick = (e) => {
    const t = e.target.dataset.tab;
    if (!t) return;
    tab = t;
    render();
    if (t === "mockup") paintMockup();
    if (t === "adhoc") paintDrafts();
  };
  $("armAll")?.addEventListener("click", async () => {
    await api("/studio/api/products/" + product.id + "/arm", { method: "POST", body: "{}" });
    await loadProduct();
  });
  document.querySelectorAll("[data-arm]").forEach(b => b.onclick = async () => {
    await api("/studio/api/products/" + product.id + "/arm", { method: "POST", body: JSON.stringify({ ids: [b.dataset.arm] }) });
    await loadProduct();
  });
  document.querySelectorAll("[data-pause]").forEach(b => b.onclick = async () => {
    await api("/studio/api/posts/" + b.dataset.pause + "/pause", { method: "POST", body: "{}" });
    await loadProduct();
  });
  document.querySelectorAll("[data-retry]").forEach(b => b.onclick = async () => {
    await api("/studio/api/posts/" + b.dataset.retry + "/retry", { method: "POST", body: "{}" });
    await loadProduct();
  });
  $("previewPlan")?.addEventListener("click", async () => {
    const data = await api("/studio/api/parse", { method: "POST", body: JSON.stringify({ raw: $("planRaw").value }) });
    $("planPreview").textContent = data.count + " post(s): " + data.items.map(i => i.date + " " + Object.keys(i.copy).join("+")).join(" · ");
  });
  async function savePlan(arm) {
    const data = await api("/studio/api/products/" + product.id + "/plans", {
      method: "POST",
      body: JSON.stringify({ title: $("planTitle").value, rawText: $("planRaw").value, arm }),
    });
    $("planPreview").textContent = "Saved " + data.posts + " posts as " + data.status + ".";
    tab = "queue";
    await loadProduct();
  }
  $("savePlan")?.addEventListener("click", () => savePlan(false).catch(err => $("planPreview").textContent = err.message));
  $("armPlan")?.addEventListener("click", () => savePlan(true).catch(err => $("planPreview").textContent = err.message));

  document.querySelectorAll("[data-asset]").forEach(img => img.onclick = () => {
    const id = img.dataset.asset;
    if (selectedAssets.has(id)) selectedAssets.delete(id); else selectedAssets.add(id);
    img.classList.toggle("on");
  });

  $("adhocIdea")?.addEventListener("input", (e) => { adhocIdea = e.target.value; });
  $("suggestDrafts")?.addEventListener("click", async () => {
    adhocIdea = $("adhocIdea")?.value.trim() || "";
    const box = $("draftResults");
    if (!adhocIdea) { if (box) box.innerHTML = '<span class="err">Describe the idea first.</span>'; return; }
    if (box) box.innerHTML = '<span class="muted">Drafting…</span>';
    try {
      const data = await api("/studio/api/products/" + product.id + "/drafts", {
        method: "POST",
        body: JSON.stringify({ idea: adhocIdea }),
      });
      draftOptions = data.options || [];
      paintDrafts();
    } catch (err) {
      if (box) box.innerHTML = \`<span class="err">\${esc(err.message)}</span>\`;
    }
  });

  async function sendAdhoc(postNow) {
    const copy = {};
    for (const c of CHANNELS) {
      const v = $("copy-" + c.kind)?.value.trim();
      if (v) copy[c.kind] = v;
    }
    if (copy.instagram && selectedAssets.size === 0) {
      $("adhocMsg").innerHTML = '<span class="err">Instagram needs an image. Attach one from Visuals, then post.</span>';
      return;
    }
    const when = $("adhocWhen")?.value;
    try {
      const data = await api("/studio/api/products/" + product.id + "/posts", {
        method: "POST",
        body: JSON.stringify({
          hook: $("adhocHook").value,
          copy,
          postNow,
          scheduledAt: when ? new Date(when).toISOString() : undefined,
          assetIds: [...selectedAssets],
        }),
      });
      $("adhocMsg").innerHTML = \`<span class="ok">Queued for \${fmt(data.scheduledAt)}</span>\`;
      tab = "queue";
      await loadProduct();
    } catch (err) {
      $("adhocMsg").innerHTML = \`<span class="err">\${esc(err.message)}</span>\`;
    }
  }
  $("postNow")?.addEventListener("click", () => sendAdhoc(true));
  $("scheduleAdhoc")?.addEventListener("click", () => sendAdhoc(false));

  async function uploadFiles(files) {
    for (const file of files) {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("kind", "upload");
      await fetch("/studio/api/products/" + product.id + "/assets", { method: "POST", body: fd, credentials: "same-origin" });
    }
    await loadProduct();
  }
  const drop = $("visDrop") || $("adhocDrop");
  if (drop) {
    drop.onclick = () => $("filePick")?.click();
    drop.ondragover = (e) => { e.preventDefault(); };
    drop.ondrop = (e) => { e.preventDefault(); uploadFiles(e.dataTransfer.files); };
  }
  $("filePick")?.addEventListener("change", (e) => uploadFiles(e.target.files));

  $("addMsg")?.addEventListener("click", () => {
    mockup.messages.push({ who: "user", text: "OK", time: "" });
    paintMockup();
  });
  $("mkKicker")?.addEventListener("input", (e) => mockup.kicker = e.target.value);
  $("mkHeadline")?.addEventListener("input", (e) => mockup.headline = e.target.value);
  $("mkMsgs")?.addEventListener("input", (e) => {
    const i = Number(e.target.dataset.mi);
    const f = e.target.dataset.f;
    if (Number.isNaN(i) || !f) return;
    mockup.messages[i][f] = e.target.value;
    paintMockup();
  });
  $("saveMockup")?.addEventListener("click", async () => {
    $("mkMsg").textContent = "Capturing…";
    const { toPng } = await import("https://cdn.jsdelivr.net/npm/html-to-image@1.11.11/+esm");
    const dataUrl = await toPng($("phone"), { pixelRatio: 3, backgroundColor: "#12162E" });
    const blob = await (await fetch(dataUrl)).blob();
    const fd = new FormData();
    fd.append("file", new File([blob], "mockup.png", { type: "image/png" }));
    fd.append("kind", "mockup");
    const res = await fetch("/studio/api/products/" + product.id + "/assets", { method: "POST", body: fd, credentials: "same-origin" });
    const data = await res.json();
    if (!res.ok) { $("mkMsg").textContent = data.error || "save failed"; return; }
    selectedAssets.add(data.asset.id);
    $("mkMsg").textContent = "Saved to Visuals.";
    assets = (await api("/studio/api/products/" + product.id + "/assets")).assets;
  });

  document.querySelectorAll("[data-save-ch]").forEach(btn => btn.onclick = async () => {
    const kind = btn.dataset.saveCh;
    const creds = {};
    document.querySelectorAll(\`[data-kind="\${kind}"][data-key]\`).forEach(inp => {
      if (inp.dataset.key === "handle" || inp.dataset.key === "enabled") return;
      if (inp.value) creds[inp.dataset.key] = inp.value;
    });
    const handle = document.querySelector(\`[data-kind="\${kind}"][data-key="handle"]\`)?.value || "";
    const enabled = document.querySelector(\`[data-kind="\${kind}"][data-key="enabled"]\`)?.checked;
    try {
      await api("/studio/api/products/" + product.id + "/channels/" + kind, {
        method: "PUT",
        body: JSON.stringify({ handle, enabled, creds }),
      });
      $("handleMsg").innerHTML = \`<span class="ok">Saved \${kind}</span>\`;
      await refresh();
    } catch (err) {
      $("handleMsg").innerHTML = \`<span class="err">\${esc(err.message)}</span>\`;
    }
  });
  paintDrafts();
}

$("newProduct").onclick = async () => {
  const name = prompt("Product name");
  if (!name) return;
  const slug = prompt("Slug (url-safe)", name.toLowerCase().replace(/\\s+/g, "-"));
  if (!slug) return;
  await api("/studio/api/products", { method: "POST", body: JSON.stringify({ name, slug }) });
  await refresh();
};

refresh().catch((err) => { $("empty").textContent = err.message; });
</script>
</body>
</html>`;
}
