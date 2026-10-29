/**
 * Service-location geometry helpers.
 *
 * Deliberately dependency-free (no Leaflet, no Supabase, no server-only
 * imports) so the SAME validation runs in the customer wizard, in the route
 * handler that persists the request and in the technician/admin views that
 * build a Google Maps link. A coordinate is never trusted just because it
 * arrived in a request body — see `toServiceCoordinates()`.
 */

/** Roughly the Cagayan de Oro city centre. Used ONLY as the initial map view. */
export const DEFAULT_MAP_CENTER = { latitude: 8.4822, longitude: 124.6472 } as const;

/**
 * Zoom for the default (empty) view and for a selected point.
 *
 * The empty view used to open at 12 — the whole city — so finding your own street
 * meant several zoom steps before anything useful was on screen. 14 is
 * neighbourhood level: recognisable barangay and main roads, still wide enough to
 * orient yourself, and one or two steps from a house.
 */
export const DEFAULT_MAP_ZOOM = 14;
export const LOCATION_MAP_ZOOM = 16;

/** Longest address we will store / echo back into a URL. */
export const MAX_ADDRESS_LENGTH = 400;

export interface ServiceCoordinates {
  latitude: number;
  longitude: number;
}

/** A service request's saved location, as the UI consumes it. */
export interface ServiceLocation {
  address: string | null;
  coordinates: ServiceCoordinates | null;
}

export function isValidLatitude(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= -90 && value <= 90;
}

export function isValidLongitude(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= -180 && value <= 180;
}

/**
 * Validates a coordinate PAIR. Accepts numbers or numeric strings (a form
 * posts strings), rejects anything out of range, NaN, Infinity or half a pair.
 * Returns `null` rather than a partially-valid object, so a caller can never
 * persist a latitude without a longitude.
 */
export function toServiceCoordinates(
  latitude: unknown,
  longitude: unknown
): ServiceCoordinates | null {
  if (latitude === null || latitude === undefined || latitude === "") return null;
  if (longitude === null || longitude === undefined || longitude === "") return null;

  const lat = typeof latitude === "number" ? latitude : Number(latitude);
  const lng = typeof longitude === "number" ? longitude : Number(longitude);

  if (!isValidLatitude(lat) || !isValidLongitude(lng)) return null;

  // 6 decimal places is ~11 cm of precision — far more than a street address
  // needs, and it keeps the stored value stable across a round trip.
  return { latitude: round6(lat), longitude: round6(lng) };
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

export function formatCoordinates(coordinates: ServiceCoordinates): string {
  return `${coordinates.latitude.toFixed(6)}, ${coordinates.longitude.toFixed(6)}`;
}

/**
 * Trims an address for storage. Control characters (which would corrupt a
 * URL or a log line) are stripped and the result is capped at
 * `MAX_ADDRESS_LENGTH`. Returns null for an empty/blank address so "no address
 * given" is stored as NULL rather than an empty string.
 */
export function sanitizeAddress(value: unknown): string | null {
  if (typeof value !== "string") return null;
  // eslint-disable-next-line no-control-regex -- intentionally stripping C0/C1 controls
  const cleaned = value.replace(/[\u0000-\u001F\u007F]/g, " ").trim();
  if (!cleaned) return null;
  return cleaned.slice(0, MAX_ADDRESS_LENGTH);
}

/**
 * A Google Maps directions URL, or null when there is nothing to navigate to.
 *
 * Coordinates win when they are present and valid; otherwise the (encoded)
 * service address is used. Google does the routing and turn-by-turn
 * navigation — SPARKServ never calculates a route itself, and no API key is
 * involved, so this URL is safe to render on the client.
 */
export function googleMapsDirectionsUrl(location: {
  address?: string | null;
  coordinates?: ServiceCoordinates | null;
}): string | null {
  const params = new URLSearchParams({ api: "1", travelmode: "driving" });

  const coordinates = location.coordinates;
  if (coordinates && isValidLatitude(coordinates.latitude) && isValidLongitude(coordinates.longitude)) {
    params.set("destination", `${coordinates.latitude},${coordinates.longitude}`);
    return `https://www.google.com/maps/dir/?${params.toString()}`;
  }

  const address = sanitizeAddress(location.address);
  if (!address) return null;

  params.set("destination", address);
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

/**
 * Same as above, for a row shaped like `service_requests`: `latitude` /
 * `longitude` may be null and `location` is the free-text address. Used by the
 * technician and admin views so every "Get directions" link on the site is
 * built by one function.
 */
export function directionsUrlForRequest(request: {
  latitude?: number | null;
  longitude?: number | null;
  location?: string | null;
}): string | null {
  return googleMapsDirectionsUrl({
    address: request.location ?? null,
    coordinates: toServiceCoordinates(request.latitude, request.longitude),
  });
}
