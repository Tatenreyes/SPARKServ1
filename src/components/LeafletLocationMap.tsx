"use client";

/**
 * The Leaflet map itself.
 *
 * This module imports `leaflet` at the top level, and Leaflet reads `window` /
 * `document` while its own modules are evaluated — so this file must never be
 * part of the server bundle. It is only ever reached through
 * `ServiceLocationMap`, which loads it with `next/dynamic({ ssr: false })`.
 *
 * Tiles come from OpenStreetMap (attribution is rendered by Leaflet from the
 * TileLayer below). No Google Maps JavaScript API key is used anywhere: the
 * "Get directions" link is a plain URL handed to Google Maps.
 */

import { useEffect, useMemo, useState } from "react";
import L from "leaflet";
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import {
  DEFAULT_MAP_CENTER,
  DEFAULT_MAP_ZOOM,
  LOCATION_MAP_ZOOM,
  toServiceCoordinates,
  type ServiceCoordinates,
} from "@/lib/geo";

/** OSM's public tile endpoint. Usage policy: attribution + no bulk downloading. */
const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors';
/** OSM serves tiles up to zoom 19. */
const TILE_MAX_ZOOM = 19;

/** Recentre only when the pin is far from the current centre (metres). */
const RECENTER_THRESHOLD_METRES = 150;

export interface LeafletLocationMapProps {
  value: ServiceCoordinates | null;
  onChange?: (coordinates: ServiceCoordinates) => void;
  /** `false` renders a read-only map (marker not draggable, clicks ignored). */
  interactive?: boolean;
  /** Initial view when `value` is null. Defaults to Cagayan de Oro. */
  center?: ServiceCoordinates;
  zoom?: number;
  className?: string;
}

export default function LeafletLocationMap({
  value,
  onChange,
  interactive = true,
  center,
  zoom,
  className = "h-64 w-full sm:h-72",
}: LeafletLocationMapProps) {
  // A divIcon keeps the marker out of Leaflet's PNG icon assets, which need
  // bundler-specific URL rewriting and are the usual cause of a missing pin.
  const pinIcon = useMemo(() => createPinIcon(), []);
  // The wheel hint disappears for good on the first interaction with the map.
  const [wheelReady, setWheelReady] = useState(false);

  const initialCenter = value ?? center ?? DEFAULT_MAP_CENTER;

  return (
    <div className="relative">
      <MapContainer
        center={[initialCenter.latitude, initialCenter.longitude]}
        zoom={value ? Math.max(zoom ?? DEFAULT_MAP_ZOOM, LOCATION_MAP_ZOOM) : zoom ?? DEFAULT_MAP_ZOOM}
        // The wheel is OFF until the customer clicks the map (see
        // WheelZoomOnDemand). A full-width map that eats the page scroll as soon as
        // the cursor crosses it is worse than one that needs a click, and the click
        // is what makes the wheel — and the keyboard — available.
        scrollWheelZoom={false}
        // Pinch-zoom, double-tap/double-click and the arrow/+/- keys, all on. These
        // are the zoom gestures a phone and a keyboard already have; they were never
        // the problem, the wheel and the button size were.
        touchZoom
        doubleClickZoom
        keyboard
        zoomControl
        className={className}
      >
        <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} maxZoom={TILE_MAX_ZOOM} />
        <KeepMapSized />
        <RecenterOnValue value={value} />
        <ClickToPlace enabled={interactive} onChange={onChange} />
        <WheelZoomOnDemand onReady={() => setWheelReady(true)} />
        {value && (
          <Marker
            position={[value.latitude, value.longitude]}
            icon={pinIcon}
            draggable={interactive}
            eventHandlers={
              interactive
                ? {
                    dragend: (event) => {
                      const marker = event.target as L.Marker;
                      const next = toServiceCoordinates(
                        marker.getLatLng().lat,
                        marker.getLatLng().lng
                      );
                      if (next) onChange?.(next);
                    },
                  }
                : undefined
            }
          />
        )}
      </MapContainer>

      {/* Sits above the tiles (z 500) and below the zoom buttons (z 800+), and never
          intercepts a tap. Only on the picker: a small read-only card does not need
          the instruction, and the wheel still works there after a click. */}
      {interactive && !wheelReady && (
        <p className="pointer-events-none absolute bottom-2 left-2 z-[500] rounded-full bg-ink/75 px-2.5 py-1 text-[11px] font-medium text-white shadow-sm">
          Click the map, then scroll or pinch to zoom
        </p>
      )}
    </div>
  );
}

/**
 * Turns the mouse wheel into zoom once the customer has clicked (or tabbed into)
 * the map, and back off when the pointer leaves it.
 *
 * Without this the wheel did nothing at all — `scrollWheelZoom={false}` — so the
 * only way to zoom was Leaflet's 26px +/- buttons. Enabling it on hover instead
 * would trade one annoyance for another: the map fills the card, and scrolling the
 * form past it would start zooming the map.
 */
function WheelZoomOnDemand({ onReady }: { onReady?: () => void }) {
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer();

    const enable = () => {
      map.scrollWheelZoom.enable();
      onReady?.();
    };
    const disable = () => map.scrollWheelZoom.disable();

    container.addEventListener("pointerdown", enable);
    container.addEventListener("focus", enable);
    container.addEventListener("pointerleave", disable);
    container.addEventListener("blur", disable);

    return () => {
      container.removeEventListener("pointerdown", enable);
      container.removeEventListener("focus", enable);
      container.removeEventListener("pointerleave", disable);
      container.removeEventListener("blur", disable);
    };
  }, [map, onReady]);

  return null;
}

/** Leaflet needs an explicit size; a collapsed section reports 0 until shown. */
function KeepMapSized() {
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer();
    const resize = () => map.invalidateSize();
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
    observer?.observe(container);
    window.addEventListener("resize", resize);
    const frame = window.setTimeout(resize, 0);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", resize);
      window.clearTimeout(frame);
    };
  }, [map]);

  return null;
}

/**
 * Follows `value` when it is set from outside the map (Geolocation, "use my
 * last service address"). A small drag does not move the viewport, so
 * correcting a pin stays predictable.
 */
function RecenterOnValue({ value }: { value: ServiceCoordinates | null }) {
  const map = useMap();
  const latitude = value?.latitude ?? null;
  const longitude = value?.longitude ?? null;

  useEffect(() => {
    if (latitude === null || longitude === null) return;
    const target = L.latLng(latitude, longitude);
    const moved = map.distance(map.getCenter(), target);
    if (moved > RECENTER_THRESHOLD_METRES || map.getZoom() < LOCATION_MAP_ZOOM) {
      map.setView(target, Math.max(map.getZoom(), LOCATION_MAP_ZOOM));
    }
  }, [map, latitude, longitude]);

  return null;
}

/** Tap/click anywhere on the map to place or move the pin. */
function ClickToPlace({
  enabled,
  onChange,
}: {
  enabled: boolean;
  onChange?: (coordinates: ServiceCoordinates) => void;
}) {
  useMapEvents({
    click(event) {
      if (!enabled || !onChange) return;
      // Validated before it leaves the map: an out-of-range value can never
      // reach form state, let alone the database.
      const next = toServiceCoordinates(event.latlng.lat, event.latlng.lng);
      if (next) onChange(next);
    },
  });

  return null;
}

function createPinIcon(): L.DivIcon {
  return L.divIcon({
    // Replacing the default `leaflet-div-icon` class drops Leaflet's white box.
    className: "spark-map-pin",
    html: [
      '<svg xmlns="http://www.w3.org/2000/svg" width="34" height="44" viewBox="0 0 34 44" aria-hidden="true">',
      '<path d="M17 1C8.2 1 1 8.2 1 17c0 12.1 16 26 16 26s16-13.9 16-26C33 8.2 25.8 1 17 1z" fill="#0E429F" stroke="#ffffff" stroke-width="2"/>',
      '<circle cx="17" cy="17" r="6" fill="#ffffff"/>',
      "</svg>",
    ].join(""),
    iconSize: [34, 44],
    iconAnchor: [17, 44],
  });
}
