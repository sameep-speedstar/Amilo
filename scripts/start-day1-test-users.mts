import postgres from "postgres";
import { welcomeMessages, localDayBoundsUtc } from "@amilo/core";

const HOST = "+918108506999";
const TEST_PHONES = ["+919873245041", "+919779840201", "+14252057172"];

const WABA_TOKEN = process.env.WABA_ACCESS_TOKEN!;
const PHONE_NUMBER_ID = process.env.WABA_PHONE_NUMBER_ID!;

async function sendWaText(toDigits: string, text: string): Promise<unknown> {
  const res = await fetch(
    `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WABA_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: toDigits,
        type: "text",
        text: { body: text.slice(0, 4096) },
      }),
    },
  );
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`WA send failed ${res.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL missing");
  if (!WABA_TOKEN || !PHONE_NUMBER_ID) throw new Error("WABA creds missing");

  const sql = postgres(process.env.DATABASE_URL, { ssl: "require", max: 1 });
  const users = await sql`
    select u.id, u.phone_e164, u.name, u.tz as timezone, u.prefs,
           c.address as wa_id, c.last_inbound_at
    from users u
    left join channels c on c.user_id = u.id and c.kind = 'whatsapp'
    where u.phone_e164 = any(${TEST_PHONES})
  `;

  console.log(
    "Targets:",
    users.map((u) => ({
      phone: u.phone_e164,
      name: u.name,
      lastIn: u.last_inbound_at,
    })),
  );

  const now = new Date();
  for (const u of users) {
    if (u.phone_e164 === HOST) continue;
    const tz = (u.timezone as string) || "Asia/Kolkata";
    const { day } = localDayBoundsUtc(tz, now);
    const prefs = (u.prefs ?? {}) as Record<string, unknown>;
    const onboarding = {
      startedAt: now.toISOString(),
      startedLocalDay: day,
      guideComplete: false,
      skipped: false,
      completedMilestones: [],
      lastTipLocalDay: null,
      lastTipId: null,
    };
    const nextPrefs = { ...prefs, onboarding };
    await sql`
      update users
      set prefs = ${sql.json(nextPrefs as never)}
      where id = ${u.id}
    `;

    const bubbles = welcomeMessages(u.name as string | null);
    const to = String(u.wa_id || u.phone_e164).replace(/\D/g, "");
    console.log(`\n=== Sending Day 1 to ${u.name} (${u.phone_e164}) localDay=${day} ===`);
    for (const [i, text] of bubbles.entries()) {
      console.log(`--- bubble ${i + 1} ---\n${text.slice(0, 160)}…`);
      try {
        const result = await sendWaText(to, text);
        console.log("OK", JSON.stringify(result));
      } catch (err) {
        console.error("SEND FAIL", err instanceof Error ? err.message : err);
      }
    }
  }

  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
