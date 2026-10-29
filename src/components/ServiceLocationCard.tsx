"use client";

/**
 * A saved service location, rendered read-only.
 *
 * One component for three audiences, because they must never disagree:
 *   * the customer, reviewing the request they submitted;
 *   * the ASSIGNED technician (map + "Get Directions"), and
 *   * an administrator inspecting a job.
 *
 * It handles all three data shapes a request can be in: address + pin, address
 * only (no map selection was made, or the map failed to load), and nothing at
 * all. "Get Directions" falls back to the URL-encoded written address whenever
 * coordinates are missing, and the map is simply not rendered in that case.
 */

import { MapPin, Navigation, MapPinOff } from "lucide-react";
import ServiceLocationMap from "@/components/ServiceLocationMap";
import { directionsUrlForRequest, formatCoordinates, toServiceCoordinates } from "@/lib/geo";

export interface ServiceLocationCardProps {
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  /** Heading, e.g. "Service location" or "Pickup address". */
  title?: string;
  /** Show the Google Maps directions button (technician / admin views). */
  showDirections?: boolean;
  /** Copy used when the request has neither an address nor a pin. */
  emptyMessage?: string;
  className?: string;
}

export default function ServiceLocationCard({
  address,
  latitude,
  longitude,
  title = "Service location",
  showDirections = false,
  emptyMessage = "No service location was recorded for this request.",
  className = "",
}: ServiceLocationCardProps) {
  const coordinates = toServiceCoordinates(latitude, longitude);
  const directionsUrl = showDirections
    ? directionsUrlForRequest({ latitude, longitude, location: address })
    : null;

  return (
    <section className={`rounded-card border border-ink/8 bg-surface p-4 shadow-card sm:p-5 ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="flex items-center gap-1.5 font-display text-sm font-semibold text-ink">
          <MapPin className="h-4 w-4 shrink-0 text-brand-ink" aria-hidden="true" />
          {title}
        </h2>
        {directionsUrl && (
          <a
            href={directionsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-[36px] cursor-pointer items-center gap-1.5 rounded-full bg-brand-600 px-3.5 text-xs font-semibold text-white transition duration-200 hover:bg-brand-700"
          >
            <Navigation className="h-3.5 w-3.5" aria-hidden="true" />
            Get directions
          </a>
        )}
      </div>

      {!address && !coordinates ? (
        <p className="mt-3 flex items-start gap-2 rounded-xl border border-line bg-soft/60 px-3 py-2.5 text-xs leading-relaxed text-muted">
          <MapPinOff className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {emptyMessage}
        </p>
      ) : (
        <>
          <p className="mt-2 break-words text-sm font-medium text-ink">
            {address ?? "Address not recorded"}
          </p>

          {coordinates ? (
            <>
              <p className="mt-1 font-mono text-[11px] text-muted">
                {formatCoordinates(coordinates)}
              </p>
              <div className="mt-3">
                <ServiceLocationMap value={coordinates} interactive={false} className="h-52 w-full sm:h-64" />
              </div>
              {showDirections && (
                <p className="mt-2 text-[11px] leading-relaxed text-muted">
                  Directions open in Google Maps on your device — SPARKServ does not
                  calculate the route itself.
                </p>
              )}
            </>
          ) : (
            <p className="mt-2 rounded-xl border border-line bg-soft/60 px-3 py-2.5 text-xs leading-relaxed text-muted">
              No map pin was saved for this request
              {showDirections
                ? ", so directions will use the written address above."
                : ", so only the written address is shown."}
            </p>
          )}
        </>
      )}
    </section>
  );
}
