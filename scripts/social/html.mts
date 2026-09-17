import type { ChatMessage } from "./types.mts";

export type FrameInput = {
  layout: "feed" | "story" | "square";
  kicker: string;
  headline: string;
  dayChip?: string;
  messages?: ChatMessage[];
  /** Real screenshot as a data URL. Replaces the fake thread; no second WhatsApp chrome. */
  photoDataUrl?: string;
};

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatText(s: string): string {
  return escapeHtml(s)
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replaceAll("\n", "<br>");
}

const WORDMARK = `<svg viewBox="0 0 512 512" aria-hidden="true"><path d="M 332.1 112.2 A 162 162 0 1 0 414.5 289.7" fill="none" stroke="#FBFAF6" stroke-width="56" stroke-linecap="round"/><circle cx="402.8" cy="187.5" r="46" fill="#F2A93B"/></svg>`;

function voiceHtml(): string {
  const bars = Array.from({ length: 16 }, (_, i) => {
    const h = 6 + ((i * 7) % 14);
    return `<i style="height:${h}px"></i>`;
  }).join("");
  return `<span class="voice"><span class="play">▶</span><span class="wave">${bars}</span><b>0:14</b></span>`;
}

function messagesHtml(messages: ChatMessage[]): string {
  return messages
    .map((m) => {
      const body = m.kind === "voice" ? voiceHtml() : formatText(m.text ?? "");
      const tick = m.who === "user" ? ` <span class="tick">✓✓</span>` : "";
      return `<div class="msg ${m.who}">${body}<span class="meta">${escapeHtml(m.time)}${tick}</span></div>`;
    })
    .join("");
}

function phoneHtml(input: FrameInput): string {
  if (input.photoDataUrl) {
    return `<div class="phone photo-phone">
      <div class="notch"></div>
      <div class="photo-screen"><img src="${input.photoDataUrl}" alt=""></div>
    </div>`;
  }
  const day = input.dayChip
    ? `<div class="day-chip">${escapeHtml(input.dayChip)}</div>`
    : "";
  return `<div class="phone">
    <div class="notch"></div>
    <div class="screen">
      <div class="chat-head">
        <div class="avatar">A</div>
        <div class="who"><b>Amilo</b><span>your chief of staff · online</span></div>
      </div>
      <div class="thread">${day}${messagesHtml(input.messages ?? [])}</div>
      <div class="compose"><div class="pill">Message</div><div class="send"></div></div>
    </div>
  </div>`;
}

export function frameHtml(input: FrameInput): string {
  const size =
    input.layout === "story"
      ? { w: 1080, h: 1920 }
      : input.layout === "square"
        ? { w: 1080, h: 1080 }
        : { w: 1080, h: 1350 };

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,500;0,9..144,600;1,9..144,500&family=Albert+Sans:wght@400;500;600&family=Spline+Sans+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: ${size.w}px; height: ${size.h}px; overflow: hidden; }
  body {
    font-family: 'Albert Sans', system-ui, sans-serif;
    background: #12162E;
    color: #F2F1EC;
  }
  .canvas {
    width: ${size.w}px; height: ${size.h}px;
    padding: ${input.layout === "story" ? "96px 72px 80px" : "56px 64px 48px"};
    display: flex; flex-direction: column; align-items: center;
    justify-content: ${input.layout === "story" ? "flex-start" : "center"};
    gap: ${input.layout === "story" ? "36px" : "28px"};
  }
  .brand { display: flex; align-items: center; gap: 12px; align-self: flex-start; }
  .brand svg { width: 28px; height: 28px; }
  .brand b {
    font-family: 'Fraunces', serif; font-weight: 600;
    letter-spacing: 0.14em; font-size: 18px;
  }
  .copy { align-self: stretch; }
  .kicker {
    font-family: 'Spline Sans Mono', monospace;
    letter-spacing: 0.22em; text-transform: uppercase;
    font-size: 13px; color: #F2A93B; margin-bottom: 12px;
  }
  h1 {
    font-family: 'Fraunces', serif; font-weight: 500;
    font-size: ${input.layout === "square" ? "42px" : "48px"};
    line-height: 1.12; max-width: 18ch;
  }
  h1 em { font-style: italic; color: #F2A93B; }
  .phone {
    width: ${input.layout === "story" ? "560px" : "500px"};
    height: ${input.layout === "story" ? "1080px" : input.layout === "square" ? "640px" : "860px"};
    border-radius: 42px; background: #0B0B14; padding: 12px;
    flex: none; position: relative;
    outline: 1px solid rgba(255,255,255,.08);
  }
  .photo-phone { height: ${input.layout === "story" ? "1120px" : input.layout === "square" ? "680px" : "900px"}; }
  .notch {
    position: absolute; top: 12px; left: 50%; transform: translateX(-50%);
    width: 120px; height: 26px; background: #0B0B14; border-radius: 0 0 16px 16px; z-index: 4;
  }
  .screen {
    height: 100%; border-radius: 32px; overflow: hidden;
    display: flex; flex-direction: column; background: #EFE9E1;
  }
  .photo-screen {
    height: 100%; border-radius: 32px; overflow: hidden; background: #111;
  }
  .photo-screen img { width: 100%; height: 100%; object-fit: cover; object-position: top center; }
  .chat-head {
    background: #1C1B33; padding: 34px 16px 12px;
    display: flex; align-items: center; gap: 12px; flex-shrink: 0;
  }
  .avatar {
    width: 38px; height: 38px; border-radius: 50%; background: #E9A23B;
    display: grid; place-items: center;
    font-family: 'Fraunces', serif; font-weight: 600; color: #1C1B33; font-size: 18px;
  }
  .who b { display: block; font-size: 15px; color: #fff; }
  .who span { font-size: 11px; color: #8FD48F; }
  .thread {
    flex: 1; overflow: hidden; padding: 16px 12px 20px;
    display: flex; flex-direction: column; gap: 8px;
  }
  .compose {
    flex-shrink: 0; display: flex; align-items: center; gap: 8px;
    padding: 10px 12px 16px; background: #F0F0F0;
  }
  .compose .pill {
    flex: 1; background: #fff; border-radius: 22px;
    padding: 11px 16px; font-size: 14px; color: #8A8A9A;
  }
  .compose .send {
    width: 36px; height: 36px; border-radius: 50%; background: #00A884;
    flex: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='%23fff' d='M3 11.5 21 3 13.5 21 11 13z'/%3E%3C/svg%3E");
    background-repeat: no-repeat; background-position: 8px 7px; background-size: 20px;
  }
  .day-chip {
    align-self: center; background: rgba(28,27,51,.10); color: #55556A;
    font-size: 11px; padding: 4px 12px; border-radius: 12px; letter-spacing: .04em;
  }
  .msg {
    max-width: 84%; padding: 9px 12px 8px; border-radius: 12px;
    font-size: 15px; line-height: 1.45; color: #20202E;
  }
  .amilo { align-self: flex-start; background: #fff; border-top-left-radius: 4px; }
  .user { align-self: flex-end; background: #DCF3D0; border-top-right-radius: 4px; }
  .msg .meta { display: block; font-size: 10px; color: #9797A6; text-align: right; margin-top: 4px; }
  .tick { color: #4FA3E3; }
  .msg b { font-weight: 600; }
  .voice { display: flex; align-items: center; gap: 8px; min-width: 180px; }
  .play {
    width: 26px; height: 26px; border-radius: 50%; background: #1C1B33; color: #fff;
    display: grid; place-items: center; font-size: 10px;
  }
  .wave { display: flex; align-items: center; gap: 2px; height: 20px; }
  .wave i { width: 3px; background: #7C7C90; border-radius: 2px; display: block; }
  .foot {
    margin-top: auto; align-self: stretch;
    display: flex; justify-content: space-between; align-items: baseline;
    font-family: 'Spline Sans Mono', monospace; letter-spacing: .12em;
    font-size: 13px; color: #9AA0BE; text-transform: lowercase;
  }
  .foot span { color: #F2A93B; }
</style>
</head>
<body>
  <div class="canvas">
    <div class="brand">${WORDMARK}<b>AMILO</b></div>
    <div class="copy">
      <div class="kicker">${escapeHtml(input.kicker)}</div>
      <h1>${input.headline}</h1>
    </div>
    ${phoneHtml(input)}
    <div class="foot"><span>amilo.io</span>invite-only</div>
  </div>
</body>
</html>`;
}
