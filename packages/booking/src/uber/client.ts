/**
 * Uber Riders API v1.2 — estimate + request + status (token supplied by caller).
 * @see https://developer.uber.com/docs/riders/references/api
 */

const API_BASE = "https://api.uber.com/v1.2";

export type UberLatLng = { lat: number; lng: number };

export type UberProduct = {
  productId: string;
  displayName: string;
  description: string;
  capacity: number | null;
  shared: boolean;
  upfrontFareEnabled: boolean;
};

export type UberEstimate = {
  productId: string;
  displayName: string;
  fareId: string | null;
  estimate: string | null;
  lowEstimateInr: number | null;
  highEstimateInr: number | null;
  durationSecs: number | null;
  pickupEstimateSecs: number | null;
};

export type UberRideRequest = {
  requestId: string;
  status: string;
  productId: string | null;
  shared: boolean;
  eta: number | null;
};

async function uberFetch(
  accessToken: string,
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<unknown> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "Accept-Language": "en_IN",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 400) };
  }
  if (!res.ok) {
    const msg =
      json && typeof json === "object" && "message" in json
        ? String((json as { message: unknown }).message)
        : text.slice(0, 300);
    const code =
      json && typeof json === "object" && "code" in json
        ? String((json as { code: unknown }).code)
        : String(res.status);
    throw new UberApiError(res.status, code, msg || `Uber API ${res.status}`);
  }
  return json;
}

export class UberApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "UberApiError";
  }
}

export async function listUberProducts(
  accessToken: string,
  start: UberLatLng,
): Promise<UberProduct[]> {
  const q = new URLSearchParams({
    latitude: String(start.lat),
    longitude: String(start.lng),
  });
  const json = (await uberFetch(accessToken, "GET", `/products?${q}`)) as {
    products?: Array<Record<string, unknown>>;
  };
  return (json.products ?? []).map((p) => ({
    productId: String(p.product_id ?? ""),
    displayName: String(p.display_name ?? p.short_description ?? "Uber"),
    description: String(p.description ?? ""),
    capacity: typeof p.capacity === "number" ? p.capacity : null,
    shared: Boolean(p.shared),
    upfrontFareEnabled: Boolean(p.upfront_fare_enabled),
  })).filter((p) => p.productId);
}

export async function estimateUberRequest(
  accessToken: string,
  opts: {
    start: UberLatLng;
    end: UberLatLng;
    productId: string;
  },
): Promise<{
  fareId: string | null;
  estimate: string | null;
  trip?: { duration_estimate?: number; distance_estimate?: number };
  pickupEstimate?: number;
}> {
  const json = (await uberFetch(accessToken, "POST", "/requests/estimate", {
    product_id: opts.productId,
    start_latitude: opts.start.lat,
    start_longitude: opts.start.lng,
    end_latitude: opts.end.lat,
    end_longitude: opts.end.lng,
  })) as Record<string, unknown>;
  const fare = json.fare as Record<string, unknown> | undefined;
  const estimate = json.estimate as Record<string, unknown> | undefined;
  const out: {
    fareId: string | null;
    estimate: string | null;
    trip?: { duration_estimate?: number; distance_estimate?: number };
    pickupEstimate?: number;
  } = {
    fareId: fare?.fare_id ? String(fare.fare_id) : null,
    estimate:
      (fare?.display ? String(fare.display) : null) ??
      (estimate?.display ? String(estimate.display) : null) ??
      (typeof estimate?.high_estimate === "number" && typeof estimate?.low_estimate === "number"
        ? `₹${estimate.low_estimate}–${estimate.high_estimate}`
        : null),
  };
  if (json.trip && typeof json.trip === "object") {
    out.trip = json.trip as { duration_estimate?: number; distance_estimate?: number };
  }
  if (typeof json.pickup_estimate === "number") {
    out.pickupEstimate = json.pickup_estimate;
  }
  return out;
}

/** Price estimates (legacy) — useful when upfront fare isn't enabled. */
export async function getUberPriceEstimates(
  accessToken: string,
  start: UberLatLng,
  end: UberLatLng,
): Promise<
  Array<{
    productId: string;
    displayName: string;
    estimate: string | null;
    low: number | null;
    high: number | null;
    duration: number | null;
  }>
> {
  const q = new URLSearchParams({
    start_latitude: String(start.lat),
    start_longitude: String(start.lng),
    end_latitude: String(end.lat),
    end_longitude: String(end.lng),
  });
  const json = (await uberFetch(accessToken, "GET", `/estimates/price?${q}`)) as {
    prices?: Array<Record<string, unknown>>;
  };
  return (json.prices ?? []).map((p) => ({
    productId: String(p.product_id ?? ""),
    displayName: String(p.display_name ?? "Uber"),
    estimate: p.estimate != null ? String(p.estimate) : null,
    low: typeof p.low_estimate === "number" ? p.low_estimate : null,
    high: typeof p.high_estimate === "number" ? p.high_estimate : null,
    duration: typeof p.duration === "number" ? p.duration : null,
  }));
}

export async function buildUberEstimates(
  accessToken: string,
  start: UberLatLng,
  end: UberLatLng,
): Promise<UberEstimate[]> {
  const products = await listUberProducts(accessToken, start);
  const prices = await getUberPriceEstimates(accessToken, start, end);
  const priceById = new Map(prices.map((p) => [p.productId, p]));
  const out: UberEstimate[] = [];
  for (const p of products.slice(0, 6)) {
    const price = priceById.get(p.productId);
    let fareId: string | null = null;
    let estimate = price?.estimate ?? null;
    let pickupEstimateSecs: number | null = null;
    let durationSecs = price?.duration ?? null;
    if (p.upfrontFareEnabled) {
      try {
        const est = await estimateUberRequest(accessToken, {
          start,
          end,
          productId: p.productId,
        });
        fareId = est.fareId;
        if (est.estimate) estimate = est.estimate;
        if (est.pickupEstimate != null) pickupEstimateSecs = est.pickupEstimate;
        if (est.trip?.duration_estimate != null) durationSecs = est.trip.duration_estimate;
      } catch {
        /* keep price estimate */
      }
    }
    out.push({
      productId: p.productId,
      displayName: p.displayName,
      fareId,
      estimate,
      lowEstimateInr: price?.low ?? null,
      highEstimateInr: price?.high ?? null,
      durationSecs,
      pickupEstimateSecs,
    });
  }
  return out.filter((e) => e.productId);
}

export async function createUberRideRequest(
  accessToken: string,
  opts: {
    start: UberLatLng;
    end: UberLatLng;
    productId: string;
    fareId?: string | null;
  },
): Promise<UberRideRequest> {
  const body: Record<string, unknown> = {
    product_id: opts.productId,
    start_latitude: opts.start.lat,
    start_longitude: opts.start.lng,
    end_latitude: opts.end.lat,
    end_longitude: opts.end.lng,
  };
  if (opts.fareId) body.fare_id = opts.fareId;
  const json = (await uberFetch(accessToken, "POST", "/requests", body)) as Record<
    string,
    unknown
  >;
  return {
    requestId: String(json.request_id ?? ""),
    status: String(json.status ?? "processing"),
    productId: json.product_id ? String(json.product_id) : null,
    shared: Boolean(json.shared),
    eta: typeof json.eta === "number" ? json.eta : null,
  };
}

export async function getUberRideRequest(
  accessToken: string,
  requestId: string,
): Promise<UberRideRequest & { driverName?: string | null; vehicleMake?: string | null }> {
  const json = (await uberFetch(
    accessToken,
    "GET",
    `/requests/${encodeURIComponent(requestId)}`,
  )) as Record<string, unknown>;
  const driver = json.driver as Record<string, unknown> | undefined;
  const vehicle = json.vehicle as Record<string, unknown> | undefined;
  const out: UberRideRequest & { driverName?: string | null; vehicleMake?: string | null } = {
    requestId: String(json.request_id ?? requestId),
    status: String(json.status ?? "unknown"),
    productId: json.product_id ? String(json.product_id) : null,
    shared: Boolean(json.shared),
    eta: typeof json.eta === "number" ? json.eta : null,
  };
  if (driver?.name) out.driverName = String(driver.name);
  if (vehicle?.make) {
    out.vehicleMake = `${vehicle.make}${vehicle.model ? ` ${vehicle.model}` : ""}${
      vehicle.license_plate ? ` · ${vehicle.license_plate}` : ""
    }`;
  }
  return out;
}

export async function cancelUberRideRequest(
  accessToken: string,
  requestId: string,
): Promise<void> {
  await uberFetch(accessToken, "DELETE", `/requests/${encodeURIComponent(requestId)}`);
}
