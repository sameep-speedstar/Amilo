import postgres from "postgres";

const TEST_PHONES = ["+919873245041", "+919779840201", "+14252057172"];
const WABA_TOKEN = process.env.WABA_ACCESS_TOKEN!;
const PHONE_NUMBER_ID = process.env.WABA_PHONE_NUMBER_ID!;
const TEMPLATE = process.env.WABA_TEMPLATE_ALERT ?? "priority_update";

async function sendTemplate(toDigits: string, name: string, body: string) {
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
        type: "template",
        template: {
          name: TEMPLATE,
          language: { code: "en" },
          components: [
            {
              type: "body",
              parameters: [
                { type: "text", text: name.slice(0, 60) || "there" },
                { type: "text", text: body.slice(0, 280) },
              ],
            },
          ],
        },
      }),
    },
  );
  const json = await res.json();
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(json)}`);
  return json;
}

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { ssl: "require", max: 1 });
  const users = await sql`
    select u.phone_e164, u.name, c.address as wa_id, c.last_inbound_at
    from users u
    left join channels c on c.user_id = u.id and c.kind = 'whatsapp'
    where u.phone_e164 = any(${TEST_PHONES})
  `;
  await sql.end();

  const blurb =
    "Amilo is ready — reply Hi Amilo to start. Save this number in Contacts as Amilo so it's easy to find.";

  for (const u of users) {
    const to = String(u.wa_id || u.phone_e164).replace(/\D/g, "");
    const first = String(u.name || "there").split(/\s+/)[0] || "there";
    const hoursSince = u.last_inbound_at
      ? (
          (Date.now() - new Date(u.last_inbound_at as string).getTime()) /
          3600_000
        ).toFixed(0)
      : "never";
    console.log(
      `\n=== ${u.name} ${u.phone_e164} lastIn=${u.last_inbound_at} (~${hoursSince}h ago) ===`,
    );
    try {
      const result = await sendTemplate(to, first, blurb);
      console.log("OK", JSON.stringify(result));
    } catch (err) {
      console.error("FAIL", err instanceof Error ? err.message : err);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
