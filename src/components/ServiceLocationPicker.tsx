"use client";

/**
 * The customer's service-location picker: the existing address field, plus an
 * interactive map they can place a pin on and confirm.
 *
 * Rules this component holds itself to:
 *   * Nothing is sent anywhere until the customer presses "Confirm this
 *     location" — the confirmed point is the only value the wizard submits.
 *   * The browser's Geolocation API runs ONLY from the explicit "Use my
 *     location" button, once, with the browser's own permission prompt. There
 *     is no `watchPosition`, so the customer is never tracked.
 *   * A denied/unavailable permission changes nothing about the form: the
 *     address field and the map stay usable, and the request still submits.
 */

import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Crosshair, MapPin, X } from "lucide-react";
import ServiceLocationMap from "@/components/ServiceLocationMap";
import {
  formatCoordinates,
  toServiceCoordinates,
  type ServiceCoordinates,
} from "@/lib/geo";

/** One control size for the whole form (see RequestRepairWizard). */
const FIELD =
  "w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-base text-white placeholder:text-white/60 sm:text-sm";

const ACTION_BUTTON =
  "inline-flex min-h-[40px] cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-xs font-semibold text-white transition duration-200 hover:bg-soft disabled:cursor-not-allowed disabled:opacity-50";

export interface ServiceLocationPickerProps {
  /** Address field id, so the label's `htmlFor` keeps working. */
  id: string;
  label: string;
  helperText: string;
  address: string;
  onAddressChange: (value: string) => void;
  /** The CONFIRMED coordinates (or null). Owned by the wizard. */
  value: ServiceCoordinates | null;
  onChange: (value: ServiceCoordinates | null) => void;
  /**
   * `true` while a pin has been placed but not yet confirmed. The wizard uses
   * this to block submission with a clear message rather than silently
   * dropping the pin.
   */
  onPendingChange?: (pending: boolean) => void;
  /** The customer's previous service location, offered as a shortcut. */
  lastLocation?: { address: string | null; coordinates: ServiceCoordinates | null } | null;
  required?: boolean;
}

export default function ServiceLocationPicker({
  id,
  label,
  helperText,
  address,
  onAddressChange,
  value,
  onChange,
  onPendingChange,
  lastLocation,
  required = true,
}: ServiceLocationPickerProps) {
  const [draft, setDraft] = useState<ServiceCoordinates | null>(value);
  const [confirmed, setConfirmed] = useState(Boolean(value));
  const [locating, setLocating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Adopt a location that came from outside the map (the "use my last service
  // address" shortcut, or a value restored by the parent).
  useEffect(() => {
    if (!value) return;
    setDraft((current) =>
      current && current.latitude === value.latitude && current.longitude === value.longitude
        ? current
        : value
    );
    setConfirmed(true);
  }, [value]);

  function updateDraft(coordinates: ServiceCoordinates) {
    const valid = toServiceCoordinates(coordinates.latitude, coordinates.longitude);
    if (!valid) return;
    setDraft(valid);
    setConfirmed(false);
    setMessage(null);
    setError(null);
    // The previously confirmed point is withdrawn: the wizard must never submit
    // a location the customer has since moved away from.
    onChange(null);
    onPendingChange?.(true);
  }

  function confirmDraft() {
    if (!draft) {
      setError("Tap the map to drop a pin, or use “Use my location”, then confirm.");
      return;
    }
    setConfirmed(true);
    setError(null);
    setMessage("Location confirmed. The technician will be sent to this point.");
    onChange(draft);
    onPendingChange?.(false);
  }

  function clearDraft() {
    setDraft(null);
    setConfirmed(false);
    setMessage(null);
    setError(null);
    onChange(null);
    onPendingChange?.(false);
  }

  function useMyLocation() {
    setMessage(null);
    setError(null);

    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setError(
        "Your browser does not support location lookup. Please type your address and tap the map instead."
      );
      return;
    }

    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        const coordinates = toServiceCoordinates(
          position.coords.latitude,
          position.coords.longitude
        );
        if (!coordinates) {
          setError("Your device returned a location we could not use. Please tap the map instead.");
          return;
        }
        updateDraft(coordinates);
        setMessage("Found your device location. Press “Confirm this location” to use it.");
      },
      (geoError) => {
        setLocating(false);
        // Every failure path keeps the form usable: the address field and the
        // map are untouched.
        if (geoError.code === geoError.PERMISSION_DENIED) {
          setError(
            "Location permission was denied. Type your address and tap the map to place the pin instead."
          );
        } else if (geoError.code === geoError.TIMEOUT) {
          setError("Finding your location timed out. Please tap the map to place the pin.");
        } else {
          setError(
            "We could not determine your location right now. Type your address and tap the map instead."
          );
        }
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 }
    );
  }

  const canReuseLastAddress = Boolean(lastLocation?.address && lastLocation.address !== address);

  return (
    <div className="sm:col-span-2">
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-white">
        {label}
        {required ? " *" : ""}
      </label>
      <input
        id={id}
        value={address}
        onChange={(event) => onAddressChange(event.target.value)}
        required={required}
        autoComplete="street-address"
        className={FIELD}
        placeholder="House / unit, street, barangay, city"
      />

      {canReuseLastAddress && lastLocation && (
        <button
          type="button"
          onClick={() => {
            if (lastLocation.address) onAddressChange(lastLocation.address);
            if (lastLocation.coordinates) {
              // Restores the pin as well as the text: the previous request
              // stored both, so the customer does not have to re-place a point
              // they already chose.
              updateDraft(lastLocation.coordinates);
              setMessage(
                "Reused your last service address and its map pin. Press “Confirm this location”."
              );
            }
          }}
          className="mt-2 inline-flex min-h-[36px] cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-soft px-3 text-xs font-semibold text-white transition duration-200 hover:bg-brand-soft"
        >
          Use my last service address
        </button>
      )}

      <p className="mt-1.5 text-xs leading-relaxed text-white/70">{helperText}</p>

      <div className="mt-4 rounded-xl border border-line bg-surface p-3 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-white">
            <MapPin className="h-3.5 w-3.5 shrink-0 text-brand-ink" aria-hidden="true" />
            Pin the exact service location
          </p>
          {draft && (
            <button type="button" onClick={clearDraft} className={ACTION_BUTTON}>
              <X className="h-3.5 w-3.5" aria-hidden="true" /> Clear pin
            </button>
          )}
        </div>

        <p className="mt-1 text-xs leading-relaxed text-white/70">
          Tap or click the map to drop a pin, and drag the pin to fine-tune it. Click
          the map once and the scroll wheel (or a pinch) zooms in, and the big{" "}
          <span className="font-semibold text-white">+</span> /{" "}
          <span className="font-semibold text-white">−</span> buttons work any time.
          {address ? ` Written address: ${address}` : ""}
        </p>

        <div className="mt-3">
          <ServiceLocationMap value={draft} onChange={updateDraft} />
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={useMyLocation} disabled={locating} className={ACTION_BUTTON}>
            <Crosshair className="h-3.5 w-3.5" aria-hidden="true" />
            {locating ? "Finding you…" : "Use my location"}
          </button>
          <button
            type="button"
            onClick={confirmDraft}
            disabled={!draft || confirmed}
            className="inline-flex min-h-[40px] cursor-pointer items-center gap-1.5 rounded-lg bg-brand-500 px-3.5 text-xs font-semibold text-white transition duration-200 hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
            {confirmed ? "Location confirmed" : "Confirm this location"}
          </button>
        </div>

        <p className="mt-2.5 text-xs font-medium text-white" aria-live="polite">
          {confirmed && draft
            ? `Confirmed pin: ${formatCoordinates(draft)}`
            : draft
              ? "Pin placed but not confirmed yet — press “Confirm this location”."
              : "No pin yet — tap the map to place one, or skip the map and use your written address."}
        </p>

        {message && (
          <p className="mt-1.5 flex items-start gap-1.5 text-xs text-signal-ink" role="status">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {message}
          </p>
        )}
        {error && (
          <p className="mt-1.5 flex items-start gap-1.5 text-xs text-warn-ink" role="alert">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {error}
          </p>
        )}

        <p className="mt-2 text-[11px] leading-relaxed text-white/70">
          Your location is shared only with the technician assigned to this request
          and with SPARKServ staff handling it. We never track your device
          continuously.
        </p>
      </div>
    </div>
  );
}
