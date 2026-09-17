/** Google Maps Geocoding + Routes — API-key auth, no OAuth. */

const GEOCODE_BASE = "https://maps.googleapis.com/maps/api/geocode/json";
const ROUTES_BASE = "https://routes.googleapis.com/directions/v2:computeRoutes";

export type GeocodeResult = { lat: number; lng: number };
export type RouteResult = { durationMins: number; distanceMeters: number };

function latLngFromMapsUrl(url: string): GeocodeResult | null {
  const at = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (at) return { lat: Number(at[1]), lng: Number(at[2]) };
  const q = url.match(/[?&](?:q|query|destination)=(-?\d+\.\d+),(-?\d+\.\d+)/i);
  if (q) return { lat: Number(q[1]), lng: Number(q[2]) };
  const bang = url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (bang) return { lat: Number(bang[1]), lng: Number(bang[2]) };
  return null;
}

function isMapsShareUrl(address: string): boolean {
  return /share\.google\/|maps\.app\.goo\.gl\/|goo\.gl\/maps\/|google\.[^/]+\/maps/i.test(
    address,
  );
}

export class MapsClient {
  constructor(private readonly apiKey: string) {}

  /**
   * Expand share.google / maps.app.goo.gl short links and read @lat,lng from the final URL.
   * No Geocoding bill when coords are in the redirect target.
   */
  async resolveMapsShareUrl(url: string): Promise<GeocodeResult | null> {
    try {
      const direct = latLngFromMapsUrl(url);
      if (direct) return direct;
      if (!isMapsShareUrl(url)) return null;
      const res = await fetch(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(12_000),
        headers: { "User-Agent": "AmiloTravel/1.0" },
      });
      const finalUrl = res.url || url;
      const fromFinal = latLngFromMapsUrl(finalUrl);
      if (fromFinal) return fromFinal;
      // Some share pages only expose coords in HTML
      const html = await res.text();
      const htmlHit =
        html.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) ||
        html.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) ||
        html.match(/\"(-?\d+\.\d+),(-?\d+\.\d+)\"/);
      if (htmlHit) return { lat: Number(htmlHit[1]), lng: Number(htmlHit[2]) };
      return null;
    } catch {
      return null;
    }
  }

  /** None-style: returns null on any failure (never throws for travel). */
  async geocode(address: string): Promise<GeocodeResult | null> {
    try {
      if (isMapsShareUrl(address) || /^https?:\/\//i.test(address.trim())) {
        const fromShare = await this.resolveMapsShareUrl(address.trim());
        if (fromShare) return fromShare;
      }
      const url = new URL(GEOCODE_BASE);
      url.searchParams.set("address", address);
      url.searchParams.set("key", this.apiKey);
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) return null;
      const data = (await res.json()) as {
        status?: string;
        results?: Array<{ geometry?: { location?: { lat?: number; lng?: number } } }>;
      };
      if (data.status !== "OK" || !data.results?.length) return null;
      const loc = data.results[0]?.geometry?.location;
      if (loc?.lat == null || loc?.lng == null) return null;
      return { lat: Number(loc.lat), lng: Number(loc.lng) };
    } catch {
      return null;
    }
  }

  /** Traffic-aware driving duration. Call only from travel plan compute/recheck. */
  async computeRouteMinutes(
    originLat: number,
    originLng: number,
    destLat: number,
    destLng: number,
    departureTime: Date,
  ): Promise<RouteResult | null> {
    try {
      const body = {
        origin: {
          location: { latLng: { latitude: originLat, longitude: originLng } },
        },
        destination: {
          location: { latLng: { latitude: destLat, longitude: destLng } },
        },
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_AWARE",
        departureTime: departureTime.toISOString(),
      };
      const res = await fetch(ROUTES_BASE, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": this.apiKey,
          "X-Goog-FieldMask": "routes.duration,routes.distanceMeters",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as {
        routes?: Array<{ duration?: string; distanceMeters?: number }>;
      };
      const route = data.routes?.[0];
      if (!route?.duration) return null;
      const seconds = Number(String(route.duration).replace(/s$/i, ""));
      if (!Number.isFinite(seconds)) return null;
      return {
        durationMins: Math.max(1, Math.round(seconds / 60)),
        distanceMeters: Number(route.distanceMeters ?? 0),
      };
    } catch {
      return null;
    }
  }
}

/** Zero API cost — tap-to-navigate. */
export function buildMapsDeepLink(destLat: number, destLng: number): string {
  return (
    "https://www.google.com/maps/dir/?api=1" +
    `&destination=${destLat},${destLng}&travelmode=driving`
  );
}
