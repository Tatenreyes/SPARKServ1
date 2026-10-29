"use client";

/**
 * SSR-safe entry point for the interactive map.
 *
 * Leaflet touches `window`/`document` as its modules are evaluated, so the real
 * map is loaded with `next/dynamic({ ssr: false })`. This wrapper owns the two
 * states the rest of the app should never have to think about:
 *
 *   * a skeleton while the Leaflet chunk downloads, and
 *   * a plain, non-blocking notice if the map never loads.
 *
 * A map failure must never take the repair form down with it — the customer can
 * still type their address, and the request still submits.
 */

import { Component, useCallback, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { MapPinOff, RotateCcw } from "lucide-react";
import type { ServiceCoordinates } from "@/lib/geo";

const LeafletLocationMap = dynamic(() => import("@/components/LeafletLocationMap"), {
  ssr: false,
  loading: () => <MapSkeleton />,
});

export interface ServiceLocationMapProps {
  value: ServiceCoordinates | null;
  onChange?: (coordinates: ServiceCoordinates) => void;
  interactive?: boolean;
  center?: ServiceCoordinates;
  zoom?: number;
  /** Height/utility classes for the map box (defaults to 16rem, 18rem from `sm`). */
  className?: string;
}

export default function ServiceLocationMap({
  value,
  onChange,
  interactive = true,
  center,
  zoom,
  className = "h-64 w-full sm:h-72",
}: ServiceLocationMapProps) {
  const [failed, setFailed] = useState(false);
  // Remounting with a new key is the only way to retry a rejected dynamic
  // import, so the retry button bumps this.
  const [attempt, setAttempt] = useState(0);
  const handleFailure = useCallback(() => setFailed(true), []);

  if (failed) {
    return (
      <div
        role="status"
        className="flex flex-col items-center justify-center gap-2 rounded-xl border border-line bg-soft/70 px-4 py-8 text-center"
      >
        <MapPinOff className="h-5 w-5 text-muted" aria-hidden="true" />
        <p className="text-sm font-medium text-ink">The map could not be loaded</p>
        <p className="max-w-sm text-xs leading-relaxed text-muted">
          You can still enter your address above and submit your request — the
          assigned technician will use the written address for directions.
        </p>
        <button
          type="button"
          onClick={() => {
            setFailed(false);
            setAttempt((current) => current + 1);
          }}
          className="mt-1 inline-flex min-h-[36px] cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-xs font-semibold text-brand-ink transition duration-200 hover:bg-brand-soft"
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Try again
        </button>
      </div>
    );
  }

  return (
    // `isolate` keeps Leaflet's internal z-indexes (up to 700) inside this box,
    // so the map can never paint over the sticky mobile submit bar.
    <MapErrorBoundary onError={handleFailure}>
      <div className="isolate overflow-hidden rounded-xl border border-line">
        <LeafletLocationMap
          key={attempt}
          value={value}
          onChange={onChange}
          interactive={interactive}
          center={center}
          zoom={zoom}
          className={className}
        />
      </div>
    </MapErrorBoundary>
  );
}

function MapSkeleton() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex h-64 w-full items-center justify-center gap-2 bg-soft/70 sm:h-72"
    >
      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand-300 border-t-transparent" />
      <span className="text-xs font-medium text-muted">Loading map…</span>
    </div>
  );
}

/**
 * A chunk-load failure throws during render, which is exactly what an error
 * boundary is for. The class component is unavoidable here: there is no hook
 * equivalent of `componentDidCatch`.
 */
class MapErrorBoundary extends Component<
  { children: ReactNode; onError: () => void },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    // Deliberately logs only the failure, never the coordinates on screen.
    console.error("Service location map failed to load", error);
    this.props.onError();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}
