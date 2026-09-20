/**
 * Public movie / showtime helpers — research only, never logs in.
 * BookMyShow often returns 403 to bots; we degrade to links + Places cinemas.
 */

export type ScrapedVenueShows = {
  name: string;
  times: string[];
  url: string | null;
};

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/** Pull HH:MM AM/PM tokens from a blob (deduped, capped). */
function extractTimes(blob: string): string[] {
  const hits = [
    ...blob.matchAll(/\b(\d{1,2}:\d{2}\s*[AaPp][Mm])\b/g),
  ].map((m) => m[1]!.replace(/\s+/g, " ").toUpperCase());
  return [...new Set(hits)].slice(0, 12);
}

/**
 * Best-effort public HTML scrape of a BookMyShow movie / showtimes URL.
 * Returns [] on 403 / empty / parse failure — caller must still offer the link.
 */
export async function scrapeBookMyShowShowtimes(
  url: string,
): Promise<ScrapedVenueShows[]> {
  const target = url.trim();
  if (!/^https?:\/\/(?:in\.)?bookmyshow\.com\//i.test(target)) return [];

  try {
    const res = await fetch(target, {
      redirect: "follow",
      signal: AbortSignal.timeout(12_000),
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-IN,en;q=0.9",
      },
    });
    if (!res.ok) {
      console.error(
        JSON.stringify({
          event: "bms_showtimes_scrape_failed",
          status: res.status,
          url: target.slice(0, 120),
        }),
      );
      return [];
    }
    const html = decodeHtml(await res.text());
    return parseShowtimeHtml(html, target);
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "bms_showtimes_scrape_error",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return [];
  }
}

/** Parse venue blocks from BMS (or similar) HTML. */
export function parseShowtimeHtml(
  html: string,
  pageUrl: string,
): ScrapedVenueShows[] {
  const venues: ScrapedVenueShows[] = [];

  // Common pattern: venue name near time chips (avoid matching JSON key "venues")
  const venueBlocks = [
    ...html.matchAll(
      /\b(?:cinema|theatre|theater)\b[^A-Za-z0-9]{0,40}([A-Z][A-Za-z0-9 &',./-]{3,60})[\s\S]{0,400}?((?:\d{1,2}:\d{2}\s*[AaPp][Mm][\s,|/·•-]*){2,12})/g,
    ),
  ];
  for (const m of venueBlocks) {
    const name = m[1]!.replace(/\s+/g, " ").trim().slice(0, 80);
    const times = extractTimes(m[2] ?? "");
    if (name && times.length) venues.push({ name, times, url: pageUrl });
  }

  if (venues.length) return dedupeVenues(venues).slice(0, 6);

  // Fallback: extract venue objects that include showTime strings
  const objectChunks = [
    ...html.matchAll(
      /\{\s*"name"\s*:\s*"([^"]{3,80})"[\s\S]{0,2000}?"showTimes?"\s*:\s*\[([\s\S]{0,1500}?)\]/gi,
    ),
  ];
  for (const m of objectChunks) {
    const name = m[1]!.trim().slice(0, 80);
    const times = extractTimes(m[2] ?? "");
    if (name && times.length) venues.push({ name, times, url: pageUrl });
  }

  if (venues.length) return dedupeVenues(venues).slice(0, 6);

  // Last resort: any times on page under a soft cinema hint
  const times = extractTimes(html);
  if (times.length >= 2) {
    venues.push({ name: "Showtimes (see link)", times: times.slice(0, 8), url: pageUrl });
  }
  return venues;
}

function dedupeVenues(list: ScrapedVenueShows[]): ScrapedVenueShows[] {
  const seen = new Set<string>();
  const out: ScrapedVenueShows[] = [];
  for (const v of list) {
    const key = v.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

/** Listing page: pull movie titles from explore HTML when available. */
export async function scrapeBookMyShowListing(
  city: string,
  language?: string | null,
): Promise<string[]> {
  const c = (city || "bengaluru").toLowerCase().replace(/\s+/g, "-");
  const url = `https://in.bookmyshow.com/explore/movies-${c}`;
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(12_000),
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-IN,en;q=0.9",
      },
    });
    if (!res.ok) return [];
    const html = decodeHtml(await res.text());
    const titles = [
      ...html.matchAll(
        /\/movies\/[^/]+\/([a-z0-9-]+)\/ET\d+/gi,
      ),
    ]
      .map((m) =>
        m[1]!
          .replace(/-/g, " ")
          .replace(/\b\w/g, (ch) => ch.toUpperCase())
          .slice(0, 60),
      )
      .filter(Boolean);
    const uniq = [...new Set(titles)].slice(0, 8);
    if (language) {
      // Soft filter: keep titles that appear near the language word in HTML
      const lang = language.toLowerCase();
      const filtered = uniq.filter((t) => {
        const slug = t.toLowerCase().replace(/\s+/g, "-");
        const idx = html.toLowerCase().indexOf(slug);
        if (idx < 0) return true;
        return html.slice(Math.max(0, idx - 200), idx + 200).toLowerCase().includes(lang);
      });
      if (filtered.length) return filtered;
    }
    return uniq;
  } catch {
    return [];
  }
}

export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
