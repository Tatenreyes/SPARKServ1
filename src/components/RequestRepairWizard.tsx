"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  CalendarClock,
  Camera,
  CheckCircle2,
  Hash,
  ImagePlus,
  Info,
  LayoutGrid,
  MapPin,
  ShieldAlert,
  ShieldCheck,
  Tag,
  Trash2,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import AssignmentStatusCard from "@/components/AssignmentStatusCard";
import ServiceLocationPicker from "@/components/ServiceLocationPicker";
import TroubleshootingPanel from "@/components/TroubleshootingPanel";
import {
  getApplianceIssues,
  getIssueById,
} from "@/lib/appliance-issues";
import { matchIssue, type TroubleshootingOutcome } from "@/lib/issue-matching";
import { getTroubleshootingGuide } from "@/lib/troubleshooting";
import CollapsibleSection from "@/components/mobile/CollapsibleSection";
import { createClient } from "@/lib/supabase/client";
import { useUser } from "@/hooks/useUser";
import { formatCoordinates, toServiceCoordinates, type ServiceCoordinates } from "@/lib/geo";
import type { ApplianceRow, AssignmentStatus } from "@/types/database";

/**
 * One control size for the whole form: 44px tall, 16px text on a phone.
 *
 * 16px is not a style choice — iOS Safari zooms the entire viewport when a
 * focused input is smaller than 16px, which on a form this long means the
 * customer is pinching back out after every field. It drops to 15px/14px from
 * `sm` up, where the zoom never happens.
 */
const FIELD =
  "w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-base text-white placeholder:text-white sm:text-sm";

/** Section identity, used for the collapsible state map. */
type SectionKey = "appliance" | "problem" | "photos" | "service" | "summary";

/**
 * Every section starts expanded, and there is deliberately no "collapse all".
 *
 * A collapsed section can still hold an empty `required` control, and a browser
 * cannot focus or scroll to one it cannot see — it abandons the submit with no
 * message at all. So collapsing is a reading aid the customer opts into, and both
 * the submit handler and the invalid-event handler below re-expand everything
 * before validation is allowed to speak.
 */
const ALL_SECTIONS_OPEN: Record<SectionKey, boolean> = {
  appliance: true,
  problem: true,
  photos: true,
  service: true,
  summary: true,
};

const APPLIANCE_TYPES = [
  "Refrigerator",
  "Air Conditioner",
  "Washing Machine",
  "Television",
  "Electric Fan",
  "Microwave Oven",
  "Rice Cooker",
  "Electric Stove",
  "Induction Cooker",
  "Water Dispenser",
  "Electric Kettle",
  "Vacuum Cleaner",
  "Clothes Dryer",
  "Freezer",
  "Water Heater",
];

/**
 * Brand shortcuts per appliance. The appliance ISSUE list no longer lives here:
 * it is the canonical catalogue in `src/lib/appliance-issues.ts`, shared with the
 * multilingual matcher and the troubleshooting guides.
 */
const BRANDS: Record<string, string[]> = {
  Refrigerator: ["Samsung", "LG", "Panasonic", "Whirlpool", "Haier", "Condura", "Fujidenzo", "Sharp", "Electrolux", "Other"],
  "Air Conditioner": ["Samsung", "LG", "Panasonic", "Daikin", "Mitsubishi", "Carrier", "Other"],
  "Washing Machine": ["Samsung", "LG", "Panasonic", "Whirlpool", "Haier", "Condura", "Fujidenzo", "Other"],
};

export default function RequestRepairWizard() {
  const router = useRouter();
  const supabase = createClient();
  // The wizard has to know who is signed in: a new `appliances` row needs
  // `customer_id`, and the browser client has no server-side `auth.uid()` to
  // fall back on (see handleSubmit).
  const { profile } = useUser();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [serviceRequestId, setServiceRequestId] = useState<string | null>(null);
  const [assignmentStatus, setAssignmentStatus] = useState<AssignmentStatus>("matching");
  const [assignedTechnician, setAssignedTechnician] = useState<{ id: string; name: string } | null>(null);
  const [offersExpiresAt, setOffersExpiresAt] = useState<string | null>(null);
  const [assignmentPending, setAssignmentPending] = useState(false);
  // `false` only when the API asked the database and it said nobody qualifies for this
  // appliance — see `customerAssignmentCopy`. `null` means we do not know.
  const [qualifiedTechnicianAvailable, setQualifiedTechnicianAvailable] = useState<
    boolean | null
  >(null);

  const [applianceType, setApplianceType] = useState("");
  const [brand, setBrand] = useState("");
  const [modelNumber, setModelNumber] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [purchaseDate, setPurchaseDate] = useState("");
  const [warrantyStatus, setWarrantyStatus] = useState("unknown");
  const [warrantyExpiryDate, setWarrantyExpiryDate] = useState("");
  const [selectedIssueId, setSelectedIssueId] = useState("");
  /**
   * An issue the customer CONFIRMED from a detected suggestion. Kept separate
   * from `selectedIssueId` because the two are invalidated differently: editing
   * the description must clear a *detected* match (it no longer describes it) but
   * must never silently discard an issue the customer chose themselves.
   */
  const [confirmedIssueId, setConfirmedIssueId] = useState<string | null>(null);
  /** The customer rejected the current suggestion — do not nag them again. */
  const [suggestionDismissed, setSuggestionDismissed] = useState(false);
  /** What the customer reported after the checks. Optional, always. */
  const [troubleshootingOutcome, setTroubleshootingOutcome] =
    useState<TroubleshootingOutcome | null>(null);
  const [problemDescription, setProblemDescription] = useState("");
  
  const [photos, setPhotos] = useState<
    { id: string; file: File; previewUrl: string }[]
  >([]);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  /**
   * The warranty acknowledgment (§13). Only required when the customer says the
   * appliance IS under warranty, and it blocks submission until ticked — the
   * phrasing is a statement of understanding, never a waiver of rights.
   */
  const [warrantyAcknowledged, setWarrantyAcknowledged] = useState(false);
  const [openSections, setOpenSections] =
    useState<Record<SectionKey, boolean>>(ALL_SECTIONS_OPEN);

  /**
   * The customer's previous service location, reused rather than retyped (§16/§30).
   *
   * Read from their own most recent request — there is no separate saved-address
   * table in the schema, and inventing one would be a business-logic change. RLS
   * limits the query to rows the customer already owns, and both the written
   * address and the map pin are carried across, so a returning customer does not
   * have to re-place a point they already chose.
   */
  const [lastLocation, setLastLocation] = useState<{
    address: string | null;
    coordinates: ServiceCoordinates | null;
  } | null>(null);

  const [customerAppliances, setCustomerAppliances] = useState<ApplianceRow[]>([]);
  const [useExistingAppliance, setUseExistingAppliance] = useState(false);
  const [selectedExistingId, setSelectedExistingId] = useState<string | null>(null);

  const [serviceType, setServiceType] = useState("on_site");
  const [preferredDate, setPreferredDate] = useState("");
  const [preferredStart, setPreferredStart] = useState("");
  const [preferredEnd, setPreferredEnd] = useState("");
  const [serviceAddress, setServiceAddress] = useState("");
  /**
   * The map pin the customer CONFIRMED, or null. Only a confirmed point is ever
   * submitted: `locationUnconfirmed` is true between placing a pin and pressing
   * "Confirm this location", and blocks submission with an explicit message
   * rather than silently dropping the pin.
   */
  const [serviceCoordinates, setServiceCoordinates] = useState<ServiceCoordinates | null>(null);
  const [locationUnconfirmed, setLocationUnconfirmed] = useState(false);
  const [additionalNotes, setAdditionalNotes] = useState("");

  /** The warranty acknowledgment blocks submission only when it is actually due. */
  const warrantyBlocked = warrantyStatus === "yes" && !warrantyAcknowledged;

  /**
   * Display strings shared by section 5's summary card and the desktop summary
   * rail. One source each, so the two views can never drift apart.
   */
  const warrantyText =
    warrantyStatus === "yes"
      ? warrantyAcknowledged
        ? "Under warranty (notice acknowledged)"
        : "Under warranty — notice not yet acknowledged"
      : warrantyStatus === "no"
        ? "Not under warranty"
        : "Not sure";

  const serviceTypeText =
    serviceType === "on_site"
      ? "On-site repair"
      : serviceType === "home_service"
        ? "Home service"
        : "Pickup & return";

  /**
   * One source for the troubleshooting outcome, shared by the request-summary
   * section and the desktop rail. Empty when the customer never reached the
   * checks — the summaries render their own placeholder for that.
   */
  const outcomeText =
    troubleshootingOutcome === "resolved"
      ? "Customer reports it worked"
      : troubleshootingOutcome === "unresolved"
        ? "Problem remains — technician needed"
        : troubleshootingOutcome === "skipped"
          ? "Skipped"
          : "";

  /**
   * Did troubleshooting solve it? Then there is nothing to dispatch, and the booking
   * half of this form is not rendered at all (sections 3-5 below): a fault that is gone
   * needs no photos, no service address and no appointment — and creating the request
   * anyway would put a technician in the queue for work that no longer exists,
   * consuming a turn in the fairness rotation for a visit nobody needs.
   *
   * Hidden means NOT RENDERED, never merely collapsed: a collapsed section can still
   * hold a `required` control, and a browser cannot focus or scroll to one it cannot
   * see (see ALL_SECTIONS_OPEN).
   *
   * `unresolved` and `skipped` both continue to the full form — trying the checks and
   * still having a fault is the ordinary outcome, not a failure.
   */
  const needsVisit = troubleshootingOutcome !== "resolved";

  /**
   * Captured BEFORE the early return below narrows the union: after
   * `if (!needsVisit) return`, TypeScript (correctly) knows the outcome cannot be
   * "resolved" any more, so this comparison would be flagged as impossible further
   * down. Keeping it derived rather than hardcoding `false` in the payload means the
   * value stays right if the early return is ever changed.
   */
  const troubleshootingResolved = troubleshootingOutcome === "resolved";

  /** Empty string (not "No preference") when unscheduled — the rail renders its
   *  own placeholder for an untouched field. */
  const scheduleText = preferredDate
    ? `${new Date(`${preferredDate}T00:00:00`).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })}${
        preferredStart && preferredEnd
          ? `, ${preferredStart}–${preferredEnd} (PH time)`
          : " — time to be agreed"
      }`
    : "";

  /** The appliance's own issue list (shared with the matcher and the guides). */
  const applianceIssues = getApplianceIssues(applianceType);
  /**
   * The multilingual match for the current description. Pure and synchronous
   * (reviewed keyword mappings in `src/lib/issue-matching.ts`), so there is no
   * loading state to flicker through and nothing to await.
   */
  const issueMatch = useMemo(
    () => matchIssue({ applianceType, description: problemDescription }),
    [applianceType, problemDescription]
  );
  /** Explicitly selected by the customer, or a suggestion they confirmed. */
  const identifiedIssueId = selectedIssueId || confirmedIssueId || "";
  const identifiedIssue = getIssueById(applianceType, identifiedIssueId);
  /** The guide for the identified issue — null when none exists. */
  const troubleshootingGuide = getTroubleshootingGuide(applianceType, identifiedIssueId);

  /**
   * Used to re-run the browser's own validation against fully visible fields.
   *
   * A click's `onClick` handler runs *before* the browser validates the form, so a
   * `setState` in it cannot un-hide a required control in time for that same
   * validation pass. The browser would abandon the submit with no message at all
   * and the button would look broken until a second press. So when anything is
   * collapsed we take over: expand, let React commit, then submit for real on the
   * next frame.
   */
  const formRef = useRef<HTMLFormElement>(null);
  const anySectionCollapsed = Object.values(openSections).some((open) => !open);

  function handleSubmitPointer(event: React.MouseEvent<HTMLButtonElement>) {
    if (!anySectionCollapsed) return;
    event.preventDefault();
    setOpenSections(ALL_SECTIONS_OPEN);
    requestAnimationFrame(() => formRef.current?.requestSubmit());
  }

  useEffect(() => {
    async function loadAppliances() {
      const { data } = await supabase.from("appliances").select("*").order("created_at", { ascending: false });
      if (data) setCustomerAppliances(data);
    }
    async function loadLastLocation() {
      // Newest request that actually recorded a location. `maybeSingle()` keeps a
      // customer with no history at `null` instead of throwing. The coordinates
      // are read alongside the address so the "use my last service address"
      // shortcut can restore the pin too.
      const { data } = await supabase
        .from("service_requests")
        .select("location, latitude, longitude")
        .not("location", "is", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      setLastLocation(
        data
          ? {
              address: data.location ?? null,
              coordinates: toServiceCoordinates(data.latitude, data.longitude),
            }
          : null
      );
    }
    loadAppliances();
    loadLastLocation();
  }, [supabase]);

  useEffect(() => {
    if (useExistingAppliance && selectedExistingId) {
      const appliance = customerAppliances.find((a) => a.id === selectedExistingId);
      if (appliance) {
        setApplianceType(appliance.appliance_type);
        setBrand(appliance.brand ?? "");
        setModelNumber(appliance.model_number ?? "");
        setSerialNumber(appliance.serial_number ?? "");
        setPurchaseDate(appliance.purchase_date ?? "");
        setWarrantyStatus(appliance.warranty_status);
        setWarrantyExpiryDate(appliance.warranty_expiry_date ?? "");
      }
    }
  }, [useExistingAppliance, selectedExistingId, customerAppliances]);

  /**
   * Changing the appliance changes the whole issue catalogue with it, so nothing
   * from the previous appliance may survive: the selected issue, a confirmed
   * suggestion and the reported outcome all belonged to that appliance's fault
   * list. A selection that is still valid (same appliance re-applied) is kept.
   */
  useEffect(() => {
    setSelectedIssueId((current) => (getIssueById(applianceType, current) ? current : ""));
    setConfirmedIssueId(null);
    setSuggestionDismissed(false);
    setTroubleshootingOutcome(null);
  }, [applianceType]);

  /** The customer picked an issue from the list — that IS the identification. */
  function handleIssueSelect(issueId: string) {
    setSelectedIssueId(issueId);
    setConfirmedIssueId(null);
    setSuggestionDismissed(false);
    setTroubleshootingOutcome(null);
  }

  /** The customer confirmed a detected suggestion. */
  function handleConfirmSuggestion(issueId: string) {
    setConfirmedIssueId(issueId);
    setSelectedIssueId("");
    setSuggestionDismissed(false);
    setTroubleshootingOutcome(null);
  }

  /** The customer rejected the suggestion: offer the list instead of guessing. */
  function handleRejectSuggestion() {
    setConfirmedIssueId(null);
    setSuggestionDismissed(true);
  }

  /**
   * Description edits invalidate a *detected* match — the confirmation described
   * text that no longer exists — and the outcome that went with it. An issue the
   * customer selected themselves is their own decision and is kept, and the
   * description itself is never rewritten.
   */
  function handleDescriptionChange(value: string) {
    setProblemDescription(value);
    setSuggestionDismissed(false);
    if (confirmedIssueId) {
      setConfirmedIssueId(null);
      setTroubleshootingOutcome(null);
    }
  }

  function toggleSection(key: SectionKey) {
    setOpenSections((current) => ({ ...current, [key]: !current[key] }));
  }

  /**
   * Add photo files chosen from the camera or the library.
   *
   * The count is capped at six to match the upload route, and the picker resets so
   * choosing the same file twice still fires a change event.
   */
  function addPhotos(fileList: FileList | null) {
    if (!fileList?.length) return;
    const incoming = Array.from(fileList).slice(0, 6 - photos.length);
    setPhotos((current) => [
      ...current,
      ...incoming.map((file) => ({
        id: `${file.name}-${file.size}-${file.lastModified}-${Math.random()
          .toString(36)
          .slice(2)}`,
        file,
        previewUrl: URL.createObjectURL(file),
      })),
    ]);
  }

  function removePhoto(id: string) {
    setPhotos((current) => {
      const target = current.find((photo) => photo.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return current.filter((photo) => photo.id !== id);
    });
  }

  // Object URLs are a browser-managed resource; leaking them for the lifetime of
  // the tab is the usual way a long session ends up holding a few hundred
  // megabytes of decoded thumbnails.
  useEffect(() => {
    return () => {
      photos.forEach((photo) => URL.revokeObjectURL(photo.previewUrl));
    };
    // Intentionally only on unmount: per-photo revocation happens in
    // `removePhoto`, and depending on `photos` here would revoke the URL of a
    // photo that is still on screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    /**
     * Defence in depth for the resolved case. When troubleshooting fixed the fault the
     * booking half of this form is not rendered, so its fields are empty by definition —
     * and the appliance insert runs before the request POST, which would leave a stray
     * appliance row behind. The submit button is not reachable in that state; this makes
     * the guarantee hold for a programmatic submit as well.
     */
    if (!needsVisit) {
      setError(
        "Nothing was booked — you told us the checks fixed the problem. If the fault is back, say so and we will continue."
      );
      setSubmitting(false);
      return;
    }

    /**
     * The warranty acknowledgment is a hard gate, and it is enforced here as well
     * as on the disabled button so a keyboard or programmatic submit cannot walk
     * past it. Wording matters: the customer is acknowledging that they were told
     * non-authorised work may affect coverage — they are not waiving anything.
     */
    if (warrantyStatus === "yes" && !warrantyAcknowledged) {
      setError(
        "Please confirm you have read the warranty notice before submitting your request."
      );
      setOpenSections(ALL_SECTIONS_OPEN);
      setSubmitting(false);
      return;
    }

    // A requested window has to be a real window: the queue compares it against
    // bookings, so an end time at or before the start would match nobody.
    if (preferredDate && (preferredStart || preferredEnd) && !(preferredStart && preferredEnd)) {
      setError("Fill in both a start and an end time, or leave both blank.");
      setSubmitting(false);
      return;
    }
    if (preferredDate && preferredStart && preferredEnd && preferredEnd <= preferredStart) {
      setError("The preferred end time must be after the start time.");
      setSubmitting(false);
      return;
    }

    // A pin that was placed but never confirmed is a deliberate state, not an
    // oversight — say so instead of quietly submitting the request without it.
    if (locationUnconfirmed) {
      setError(
        "Confirm the location you pinned on the map (or clear the pin) before submitting your request."
      );
      setOpenSections(ALL_SECTIONS_OPEN);
      setSubmitting(false);
      return;
    }

    // Last line of defence before the coordinates leave the browser. The API and
    // the database validate again; this just keeps an impossible value from ever
    // being sent.
    const submittedCoordinates = toServiceCoordinates(
      serviceCoordinates?.latitude,
      serviceCoordinates?.longitude
    );
    if (serviceCoordinates && !submittedCoordinates) {
      setError("The map location looks invalid. Please place and confirm the pin again.");
      setOpenSections(ALL_SECTIONS_OPEN);
      setSubmitting(false);
      return;
    }

    try {
      // Evidence is uploaded BEFORE the request row exists, so `photos` can never
      // reference a file that failed to save. If the upload fails the customer
      // sees why and nothing has been created yet.
      let photoUrls: string[] = [];
      if (photos.length) {
        setUploadingPhotos(true);
        const formData = new FormData();
        photos.forEach((photo) => formData.append("photos", photo.file));
        const uploadRes = await fetch("/api/service-requests/photos", {
          method: "POST",
          body: formData,
        });
        const uploadJson = await uploadRes.json().catch(() => ({}));
        if (!uploadRes.ok) {
          throw new Error(
            uploadJson.error ?? "We could not upload your photos. Please try again."
          );
        }
        photoUrls = Array.isArray(uploadJson.urls) ? uploadJson.urls : [];
      }

      const customerId = profile?.id ?? null;
      let applianceId: string | null = null;

      if (useExistingAppliance && selectedExistingId) {
        applianceId = selectedExistingId;
      } else {
        // Two NOT NULL columns were missing from this payload, so "create a new
        // appliance" could never succeed — the insert was refused before it ever
        // reached the API:
        //   * `customer_id` is also the RLS policy's WITH CHECK
        //     (`customer_id = auth.uid()`), so omitting it fails twice over:
        //     23502 null value in column customer_id, then 42501 RLS.
        //   * `name` is NOT NULL and the wizard never asks for one, so the label
        //     shown on the customer's appliance list is derived from what they
        //     did enter.
        if (!customerId) {
          throw new Error("We could not confirm your account yet. Reload the page and try again.");
        }
        const applianceName =
          [brand.trim(), modelNumber.trim()].filter(Boolean).join(" ") || applianceType;

        const { data: appliance, error: applianceError } = await supabase
          .from("appliances")
          .insert({
            customer_id: customerId,
            name: applianceName,
            appliance_type: applianceType,
            brand: brand || null,
            model_number: modelNumber || null,
            serial_number: serialNumber || null,
            purchase_date: purchaseDate || null,
            warranty_status: warrantyStatus,
            warranty_expiry_date: warrantyExpiryDate || null,
          })
          .select()
          .single();

        if (applianceError) throw applianceError;
        applianceId = appliance.id;
      }

      const res = await fetch("/api/service-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appliance_id: applianceId,
          appliance_type: applianceType,
          // Only an IDENTIFIED issue is persisted — one the customer chose, or a
          // suggestion they explicitly confirmed. A candidate the system merely
          // detected is never written as though they had confirmed it.
          issue_category: identifiedIssue?.label ?? null,
          issue_id: identifiedIssue?.id ?? null,
          // What the customer reported after the checks (null when they skipped
          // or never saw them). It is their report, not a verified repair.
          troubleshooting_outcome: troubleshootingOutcome,
          // The legacy boolean mirrors the outcome so existing readers keep
          // working; `troubleshooting_outcome` is the detailed source of truth.
          chatbot_resolved: troubleshootingResolved,
          problem_description: problemDescription,
          photos: photoUrls,
          service_type: serviceType,
          location: serviceAddress,
          // The confirmed map pin, or null when the customer chose to give the
          // written address only. Sent as a pair; the API rejects half a pair or
          // an out-of-range value with 400.
          latitude: submittedCoordinates?.latitude ?? null,
          longitude: submittedCoordinates?.longitude ?? null,
          ...(preferredDate
            ? {
                preferred_date: preferredDate,
                ...(preferredStart ? { preferred_start_time: preferredStart } : {}),
                ...(preferredEnd ? { preferred_end_time: preferredEnd } : {}),
              }
            : {}),
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        // The API returns `detail` in development only; prefer it when present
        // so a schema problem reads as "42703: column ... does not exist"
        // instead of an unexplained failure.
        const detail = json.detail?.message
          ? ` — ${json.detail.code ?? "error"}: ${json.detail.message}`
          : "";
        throw new Error((json.error ?? "Failed to submit request") + detail);
      }

      setServiceRequestId(json.data.id);
      setAssignmentStatus(json.data.assignment_status);
      setAssignedTechnician(json.assigned_technician ?? null);
      setOffersExpiresAt(json.data.offers_expires_at ?? null);
      setAssignmentPending(Boolean(json.assignment_pending));
      setQualifiedTechnicianAvailable(json.qualified_technician_available ?? null);
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      // Whatever went wrong, the field it concerns is easier to find when no
      // section is folded away.
      setOpenSections(ALL_SECTIONS_OPEN);
    } finally {
      setSubmitting(false);
      setUploadingPhotos(false);
    }
  }

  if (submitted && serviceRequestId) {
    return (
      <div className="max-w-2xl">
        <div className="rounded-2xl border border-line bg-signal-soft p-8 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-signal-soft text-signal-ink">
            <CheckCircle2 className="h-7 w-7" />
          </div>
          <h2 className="mt-4 font-display text-xl font-semibold text-ink">Repair Request Submitted</h2>
          <p className="mt-2 text-sm text-muted">Your request has been submitted successfully. The system will check eligible technicians and place your request in the technician queue.</p>
          {assignmentPending && (
            <p role="status" className="mx-auto mt-4 max-w-lg rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
              Your request is saved. Technician matching is taking longer than expected and will retry automatically. You can check this page for updates.
            </p>
          )}
          <div className="mt-6">
            <button
              onClick={() => router.push(`/customer/service-request/${serviceRequestId}`)}
              className="inline-flex h-11 items-center justify-center rounded-xl bg-brand-600 px-6 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700"
            >
              View Repair Status
            </button>
          </div>
        </div>

        <div className="mt-6">
          <AssignmentStatusCard
            status={assignmentStatus}
            applianceType={applianceType}
            technician={assignedTechnician}
            offersExpiresAt={offersExpiresAt}
            qualifiedTechnicianAvailable={qualifiedTechnicianAvailable}
            onBackToAppliances={() => {
              setSubmitted(false);
              setServiceRequestId(null);
              setAssignedTechnician(null);
            }}
          />
        </div>
      </div>
    );
  }

  /**
   * Troubleshooting solved it: no request was sent, nothing was booked, and no appliance
   * row was created. The customer's answers are still in state, so "it came back"
   * restores the whole form exactly as they left it — which matters, because an
   * intermittent fault (a fridge that defrosted overnight) is a common reason to answer
   * "that fixed it". The wording therefore never claims the appliance was repaired.
   */
  if (!needsVisit) {
    return (
      <div className="max-w-2xl">
        <div className="rounded-2xl border border-line bg-signal-soft p-8 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-signal-soft text-signal-ink">
            <CheckCircle2 className="h-7 w-7" />
          </div>
          <h2 className="mt-4 font-display text-xl font-semibold text-ink">
            Nothing to book — the checks did the trick
          </h2>
          <p className="mt-2 text-sm text-muted">
            You told us the preliminary checks fixed it, so no repair request was sent and
            no technician has been booked. Nothing you entered has been lost.
          </p>
          <p className="mx-auto mt-3 max-w-lg text-xs leading-relaxed text-muted">
            If the fault comes back — or it only seems better for now — say so and we will
            pick up exactly where you left off.
          </p>
          <div className="mt-6 flex flex-col items-center justify-center gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => setTroubleshootingOutcome("unresolved")}
              className="inline-flex h-11 items-center justify-center rounded-xl bg-brand-600 px-6 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700"
            >
              It came back — request a visit
            </button>
            <button
              type="button"
              onClick={() => router.push("/customer/dashboard")}
              className="inline-flex h-11 items-center justify-center rounded-xl border border-line bg-surface px-6 text-sm font-semibold text-ink/75 transition hover:bg-soft"
            >
              Back to my dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      // Backstop for Enter-key submits, which never pass through the button's
      // click handler: an invalid control inside a collapsed section cannot be
      // focused or scrolled to, so the browser abandons the submit silently.
      onInvalidCapture={() => setOpenSections(ALL_SECTIONS_OPEN)}
      className="space-y-5 spark-sticky-action-offset md:!pb-0"
    >
      {/* The route header owns the title; only the workflow note stays here so
          the form starts higher on the page. */}
      <p className="text-sm leading-relaxed text-muted">
        One form, start to finish — nothing is submitted until you press the
        button at the end. We&apos;ll match you with a qualified technician.
      </p>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-alert-500/30 bg-alert-soft px-4 py-3 text-sm text-alert-ink"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {/* Desktop workspace: main form plus a live summary rail. The split
          starts at `xl` (1280px), where the content column is wide enough for
          a ~70/30 split; below that the form already fills the column and a
          side rail would just shrink the fields. `min-w-0` stops each track
          from being forced wider than its content by long inputs. */}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,7fr)_minmax(260px,3fr)]">
        <div className="min-w-0 space-y-5">
      {/* 1 ── Appliance */}
      <CollapsibleSection
        id="section-appliance"
        step={1}
        title="Appliance Information"
        hint="What we're repairing, and the numbers off the label"
        open={openSections.appliance}
        onToggle={() => toggleSection("appliance")}
      >
        {customerAppliances.length > 0 && (
          <div className="rounded-xl bg-brand-soft/70 p-4">
            <label className="flex min-h-[44px] cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                checked={useExistingAppliance}
                onChange={(e) => setUseExistingAppliance(e.target.checked)}
                className="h-5 w-5"
              />
              <span className="text-sm font-medium text-ink/80">
                Use an appliance I already saved
              </span>
            </label>
            {useExistingAppliance && (
              <>
                <select
                  aria-label="Saved appliance"
                  value={selectedExistingId ?? ""}
                  onChange={(e) => setSelectedExistingId(e.target.value)}
                  className={`mt-3 ${FIELD}`}
                >
                  <option value="">Select an appliance</option>
                  {customerAppliances.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.appliance_type} {a.brand ? `• ${a.brand}` : ""}
                    </option>
                  ))}
                </select>
                <p className="mt-2 text-xs leading-relaxed text-muted">
                  Its type, brand, model and warranty details are copied in — you
                  only need to describe the new problem.
                </p>
              </>
            )}
          </div>
        )}

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {!useExistingAppliance && (
            <>
            <div>
              <label htmlFor="appliance-type" className="mb-1.5 block text-sm font-medium text-ink/80">
                Appliance *
              </label>
              <select
                id="appliance-type"
                value={applianceType}
                onChange={(e) => setApplianceType(e.target.value)}
                required
                className={FIELD}
              >
                <option value="">Select appliance</option>
                {APPLIANCE_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-w-0">
              <label htmlFor="appliance-brand" className="mb-1.5 block text-sm font-medium text-ink/80">
                Brand *
              </label>
              <select
                id="appliance-brand"
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                required
                className={FIELD}
              >
                <option value="">Select brand</option>
                {(BRANDS[applianceType] || ["Other"]).map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-w-0">
              <label htmlFor="appliance-model" className="mb-1.5 block text-sm font-medium text-ink/80">
                Model number
              </label>
              <input
                id="appliance-model"
                value={modelNumber}
                onChange={(e) => setModelNumber(e.target.value)}
                autoComplete="off"
                className={FIELD}
                placeholder="e.g. RT32K5530S8"
              />
            </div>
            <div className="min-w-0">
              <label htmlFor="appliance-serial" className="mb-1.5 block text-sm font-medium text-ink/80">
                Serial number
              </label>
              <input
                id="appliance-serial"
                value={serialNumber}
                onChange={(e) => setSerialNumber(e.target.value)}
                autoComplete="off"
                className={FIELD}
                placeholder="From the rating label"
              />
            </div>
            <div className="min-w-0">
              <label htmlFor="appliance-purchase-date" className="mb-1.5 block text-sm font-medium text-ink/80">
                Purchase date
              </label>
              <input
                id="appliance-purchase-date"
                type="date"
                value={purchaseDate}
                onChange={(e) => setPurchaseDate(e.target.value)}
                className={FIELD}
              />
            </div>

            {/* Row 3 right: warranty status. The two real answers sit side by
                side like the reference layout, with "Not sure" spanning the row
                below; every option stays a 44px target. */}
            <fieldset className="min-w-0">
              <legend className="mb-2 block text-sm font-medium text-ink/80">
                Is it still under warranty? *
              </legend>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    { value: "yes", label: "Under warranty" },
                    { value: "no", label: "Not under warranty" },
                    { value: "unknown", label: "Not sure" },
                  ] as const
                ).map((option) => (
                  <label
                    key={option.value}
                    className={`flex min-h-[44px] cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-2.5 transition duration-200 ${
                      option.value === "unknown" ? "col-span-2" : ""
                    } ${
                      warrantyStatus === option.value
                        ? "border-brand-300 bg-brand-soft"
                        : "border-line bg-surface hover:bg-soft/70"
                    }`}
                  >
                    <input
                      type="radio"
                      name="warranty"
                      value={option.value}
                      checked={warrantyStatus === option.value}
                      onChange={(e) => setWarrantyStatus(e.target.value)}
                      className="h-5 w-5"
                    />
                    <span className="text-sm font-medium text-ink/80">{option.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <p className="text-xs leading-relaxed text-muted sm:col-span-2">
              Model and serial numbers are usually on a sticker inside the door or
              on the back of the unit. A photo of that label in step 3 works too.
            </p>
            </>
          )}
        </div>

        {warrantyStatus === "yes" && (
          <div className="mt-4 space-y-4">
            <div>
              <label
                htmlFor="warranty-expiry"
                className="mb-1.5 block text-sm font-medium text-ink/80"
              >
                Warranty expiration date
              </label>
              <input
                id="warranty-expiry"
                type="date"
                value={warrantyExpiryDate}
                onChange={(e) => setWarrantyExpiryDate(e.target.value)}
                className={FIELD}
              />
            </div>

            {/* Warranty notice (§13). This is an acknowledgment of information
                given, NOT a waiver — the customer keeps every right they have,
                and the wording and the checkbox both say so. */}
            <div className="rounded-xl border border-warn-ink/25 bg-warn-soft p-4">
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface text-warn-ink">
                  <ShieldAlert className="h-5 w-5" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-warn-ink">Warranty notice</p>
                  <p className="mt-1.5 text-xs leading-relaxed text-ink/80">
                    You indicated this appliance may still be covered by a
                    manufacturer, seller or other warranty. Using a service provider
                    that is not authorised by the warranty issuer may affect that
                    coverage, depending on the applicable warranty terms. Nothing here
                    waives any right you have — it records that this was explained to
                    you before you decided to proceed.
                  </p>
                </div>
              </div>

              <label className="mt-3.5 flex cursor-pointer items-start gap-3 rounded-xl border border-warn-ink/25 bg-surface p-3.5">
                <input
                  type="checkbox"
                  required={warrantyStatus === "yes"}
                  checked={warrantyAcknowledged}
                  onChange={(e) => setWarrantyAcknowledged(e.target.checked)}
                  className="mt-0.5 h-5 w-5 shrink-0"
                />
                <span className="text-xs leading-relaxed text-ink/80">
                  I have read and understood the warranty notice and acknowledge that
                  proceeding with this repair may affect applicable warranty coverage.
                  I still wish to submit this repair request.
                </span>
              </label>

              {!warrantyAcknowledged && (
                <p className="mt-2 text-[11px] font-medium text-warn-ink">
                  This must be ticked before the request can be submitted.
                </p>
              )}
            </div>
          </div>
        )}

      </CollapsibleSection>

      {/* 2 ── Problem */}
      <CollapsibleSection
        id="section-problem"
        step={2}
        title="Problem description"
        hint={
          applianceType
            ? `Common ${applianceType.toLowerCase()} faults, plus room to explain`
            : "Common faults, plus room to explain"
        }
        open={openSections.problem}
        onToggle={() => toggleSection("problem")}
      >
        <div>
          <p
            id="problem-category-label"
            className="mb-1.5 block text-sm font-medium text-ink/80"
          >
            What problem are you experiencing?
          </p>
          {/* The one picker. This catalogue used to appear twice — as a <select> here and
              again as six chips inside the troubleshooting panel — with a different set of
              members in each ("Other" only here, "Not defrosting" only there). Chips rather
              than a select: five to ten issues fit two rows on a phone, and a tapped chip
              is a visible answer, where a collapsed native picker hides the catalogue
              behind a tap that shows nothing. (The appliance list in step 1 keeps its
              <select> — that one runs past twenty entries.) */}
          <div
            role="group"
            aria-labelledby="problem-category-label"
            className="flex flex-wrap gap-2"
          >
            {applianceIssues.map((issue) => {
              const selected = identifiedIssueId === issue.id;
              return (
                <button
                  key={issue.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => handleIssueSelect(selected ? "" : issue.id)}
                  className={`inline-flex min-h-[40px] cursor-pointer items-center rounded-full border px-3.5 text-xs font-medium transition duration-200 ${
                    selected
                      ? "border-brand-300 bg-brand-soft text-brand-ink"
                      : "border-line bg-surface text-ink/80 hover:border-brand-300 hover:bg-brand-soft"
                  }`}
                >
                  {issue.label}
                </button>
              );
            })}
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-muted">
            Tapping one shows its preliminary checks. Not sure? Leave this empty and
            describe it below.
          </p>
        </div>

        <div className="mt-4">
          <label htmlFor="problem-description" className="mb-1.5 block text-sm font-medium text-ink/80">
            Describe the problem *
          </label>
          <textarea
            id="problem-description"
            value={problemDescription}
            onChange={(e) => handleDescriptionChange(e.target.value)}
            rows={5}
            required
            className={FIELD}
            placeholder="Tell us what happened — when it started, any sounds, smells, error codes or recent changes."
          />
        </div>

        {/* Inline troubleshooting: only ever for an issue that has actually been
            identified, never merely because an appliance was selected. The panel gets no
            issue list of its own — the chips above are the one place a fault is chosen. */}
        <TroubleshootingPanel
          applianceType={applianceType}
          match={issueMatch}
          identifiedIssueId={identifiedIssue?.id ?? null}
          guide={troubleshootingGuide}
          outcome={troubleshootingOutcome}
          onConfirmSuggestion={handleConfirmSuggestion}
          onRejectSuggestion={handleRejectSuggestion}
          onChooseIssue={handleIssueSelect}
          onOutcomeChange={setTroubleshootingOutcome}
          onSkip={() => setTroubleshootingOutcome("skipped")}
          suggestionDismissed={suggestionDismissed}
          awaitingDescription={!problemDescription.trim()}
        />
      </CollapsibleSection>

      {/* 3 ── Photos */}
      {needsVisit && (
      <CollapsibleSection
        id="section-photos"
        step={3}
        title="Photos / evidence"
        hint="Optional, but a photo of the fault or the rating label saves a visit"
        open={openSections.photos}
        onToggle={() => toggleSection("photos")}
      >
        {/* Two pickers rather than one. `capture="environment"` opens the rear
            camera directly on a phone — which is the whole point of asking for
            evidence at the machine — while the second opens the photo library for
            anything already taken. Neither is `required`: a customer who cannot
            photograph the unit must still be able to submit. */}
        <div className="grid gap-3 sm:grid-cols-2">
          <label
            htmlFor="photo-camera"
            className="flex min-h-[72px] cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed border-line bg-soft/60 px-4 py-3 transition duration-200 hover:border-brand-300 hover:bg-brand-soft/50"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface text-brand-ink">
              <Camera className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-ink">Take a photo</span>
              <span className="mt-0.5 block text-xs text-muted">Opens your camera</span>
            </span>
          </label>
          <input
            id="photo-camera"
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              addPhotos(e.target.files);
              e.target.value = "";
            }}
          />

          <label
            htmlFor="photo-library"
            className="flex min-h-[72px] cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed border-line bg-soft/60 px-4 py-3 transition duration-200 hover:border-brand-300 hover:bg-brand-soft/50"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface text-brand-ink">
              <ImagePlus className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-ink">Add photos</span>
              <span className="mt-0.5 block text-xs text-muted">
                Choose from your library
              </span>
            </span>
          </label>
          <input
            id="photo-library"
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              addPhotos(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        <p className="mt-3 text-xs leading-relaxed text-muted">
          JPG, PNG, WebP or HEIC, up to 10 MB each, six photos maximum. They are
          uploaded when you submit and stored securely with your request.
        </p>

        {photos.length > 0 && (
          <>
            <p className="mt-4 text-xs font-semibold text-muted" aria-live="polite">
              {photos.length} photo{photos.length === 1 ? "" : "s"} attached
            </p>
            <ul className="mt-2 grid grid-cols-3 gap-3 sm:grid-cols-4 2xl:grid-cols-6">
              {photos.map((photo, index) => (
                <li
                  key={photo.id}
                  className="relative aspect-square overflow-hidden rounded-xl border border-line bg-soft"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- a local
                      object URL preview; next/image cannot optimise a blob: URL. */}
                  <img
                    src={photo.previewUrl}
                    alt={`Attachment ${index + 1}, ${photo.file.name}`}
                    className="h-full w-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => removePhoto(photo.id)}
                    aria-label={`Remove attachment ${index + 1}`}
                    className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-full bg-ink/75 text-white transition duration-200 hover:bg-ink"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </CollapsibleSection>
      )}

      {/* 4 ── Service details */}
      {needsVisit && (
      <CollapsibleSection
        id="section-service"
        step={4}
        title="Service details"
        hint="How we reach the appliance, where it is, and when suits you"
        open={openSections.service}
        onToggle={() => toggleSection("service")}
      >
        <fieldset>
          <legend className="mb-2 block text-sm font-medium text-ink/80">Service type *</legend>
          {/* Cards side by side where the main column is wide enough; they stay
              one-per-row on a phone, same 56px targets either way. */}
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {(
              [
                {
                  value: "on_site",
                  label: "On-site repair",
                  hint: "Our technician comes to your address",
                },
                {
                  value: "home_service",
                  label: "Home service",
                  hint: "A longer scheduled visit at your premises",
                },
                {
                  value: "pickup_return",
                  label: "Pickup & return",
                  hint: "We collect the unit and bring it back when it's fixed",
                },
              ] as const
            ).map((option) => (
              <label
                key={option.value}
                className={`flex min-h-[56px] cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3 transition duration-200 ${
                  serviceType === option.value
                    ? "border-brand-300 bg-brand-soft"
                    : "border-line bg-surface hover:bg-soft/70"
                }`}
              >
                <input
                  type="radio"
                  name="service_type"
                  value={option.value}
                  checked={serviceType === option.value}
                  onChange={(e) => setServiceType(e.target.value)}
                  className="mt-0.5 h-5 w-5 shrink-0"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-ink/85">
                    {option.label}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted">{option.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {/* Address + interactive map. One control, because the written address
              and the confirmed pin describe the same place: the technician is
              routed to the pin, and the address is what a human reads. */}
          <ServiceLocationPicker
            id="service-address"
            label={serviceType === "pickup_return" ? "Pickup address *" : "Service address *"}
            helperText={
              serviceType === "pickup_return"
                ? "Where we collect the appliance from, and where we return it."
                : "Where the technician should go. Add a landmark or gate instructions below if the address is hard to find."
            }
            address={serviceAddress}
            onAddressChange={setServiceAddress}
            value={serviceCoordinates}
            onChange={setServiceCoordinates}
            onPendingChange={setLocationUnconfirmed}
            lastLocation={lastLocation}
          />

          <div>
            <label htmlFor="preferred-date" className="mb-1.5 block text-sm font-medium text-ink/80">
              Preferred service date
            </label>
            <input
              id="preferred-date"
              type="date"
              value={preferredDate}
              onChange={(e) => setPreferredDate(e.target.value)}
              className={FIELD}
            />
          </div>

          <div>
            <label htmlFor="preferred-start" className="mb-1.5 block text-sm font-medium text-ink/80">
              Preferred time window{" "}
              <span className="font-normal text-muted">(optional)</span>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <input
                id="preferred-start"
                type="time"
                aria-label="Preferred start time"
                value={preferredStart}
                onChange={(e) => setPreferredStart(e.target.value)}
                disabled={!preferredDate}
                className={`${FIELD} disabled:opacity-50`}
              />
              <input
                type="time"
                aria-label="Preferred end time"
                value={preferredEnd}
                onChange={(e) => setPreferredEnd(e.target.value)}
                disabled={!preferredDate}
                className={`${FIELD} disabled:opacity-50`}
              />
            </div>
          </div>
        </div>

        <p className="mt-2 text-xs leading-relaxed text-muted">
          Times are Philippine time (GMT+8). Leave the window blank if any time that day
          works — only technicians free in your window are offered the job, and you
          confirm the exact slot before the visit.
        </p>

        <div className="mt-4">
          <label htmlFor="additional-notes" className="mb-1.5 block text-sm font-medium text-ink/80">
            Landmark or instructions
          </label>
          <textarea
            id="additional-notes"
            value={additionalNotes}
            onChange={(e) => setAdditionalNotes(e.target.value)}
            rows={3}
            className={FIELD}
            placeholder="e.g. Blue gate beside the sari-sari store, ring the bell twice."
          />
        </div>
      </CollapsibleSection>
      )}

      {/* 5 ── Summary. Below `xl` only: from `xl` up the sticky rail on the
          right carries the same values, so rendering both would duplicate the
          summary on one screen. */}
      {needsVisit && (
      <CollapsibleSection
        id="section-summary"
        step={5}
        title="Request summary"
        hint="One last look before you send it"
        open={openSections.summary}
        onToggle={() => toggleSection("summary")}
        className="xl:hidden"
      >
        <dl className="grid gap-3 sm:grid-cols-2">
          <SummaryRow label="Appliance" value={applianceType || "—"} />
          <SummaryRow label="Brand" value={brand || "—"} />
          {modelNumber && <SummaryRow label="Model Number" value={modelNumber} />}
          {serialNumber && <SummaryRow label="Serial Number" value={serialNumber} />}
          <SummaryRow
            label="Warranty Status"
            value={warrantyText}
          />
          <SummaryRow
            label="Reported Problem"
            value={identifiedIssue?.label ?? "Not identified"}
          />
          <SummaryRow label="Troubleshooting" value={outcomeText} />
          <SummaryRow
            label="Service Type"
            value={serviceTypeText}
          />
          <SummaryRow
            label={
              serviceType === "pickup_return" ? "Pickup address" : "Service Address"
            }
            value={serviceAddress || "—"}
          />
          <SummaryRow
            label="Map Location"
            value={
              serviceCoordinates
                ? formatCoordinates(serviceCoordinates)
                : locationUnconfirmed
                  ? "Pin not confirmed — confirm or clear it"
                  : "No pin placed — using the written address"
            }
          />
          <SummaryRow
            label="Preferred Date & Time"
            value={scheduleText || "No preference"}
          />
          <SummaryRow
            label="Photos"
            value={
              photos.length
                ? `${photos.length} attached`
                : "None — optional"
            }
          />
        </dl>

        <p className="mt-4 border-t border-line pt-4 text-xs leading-relaxed text-muted">
          Submitting places your request in the technician queue. Nothing is charged
          and no visit is booked until you review and approve a cost estimate.
        </p>
      </CollapsibleSection>
      )}

          {/* The single desktop submission control — inline at the end of the
              main form column, sharing state with the phone bar below (each is
              gated to its own breakpoint, so only one can ever be pressed). */}
          <div className="hidden md:block">
            <button
              type="submit"
              disabled={submitting || warrantyBlocked}
              aria-describedby={warrantyBlocked ? "submit-blocked-reason-desktop" : undefined}
              onClick={handleSubmitPointer}
              className="w-full cursor-pointer rounded-xl bg-brand-500 px-6 py-3 text-sm font-semibold text-white shadow-sm transition duration-200 hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? (uploadingPhotos ? "Uploading photos..." : "Submitting...") : "Submit repair request"}
            </button>
            {warrantyBlocked && (
              <p id="submit-blocked-reason-desktop" className="mt-2 text-xs text-warn-ink">
                Tick the warranty acknowledgment in step 1 to enable this.
              </p>
            )}
          </div>
        </div>
        {/* /main form column */}

        {/* Live request summary rail (desktop only, ≥1280px). Read-only and
            built from the same state as the form above — no inputs and no
            submit here, so it cannot become a second form. `sticky top-24`
            (96px) keeps it below the topbar while the form scrolls, and 96px is
            the taller of the bar's two heights — 64px, or 64px plus the 32px
            platform-announcement strip. */}
        <aside aria-label="Request summary" className="hidden xl:block">
          <div className="sticky top-24 space-y-4">
            <section className="overflow-hidden rounded-card border border-line bg-surface shadow-[0_1px_2px_rgba(16,38,74,0.04)]">
              <div className="border-b border-line px-4 py-4">
                <h2 className="font-display text-sm font-semibold text-ink">
                  Request Summary
                </h2>
                <p className="mt-1 text-xs leading-relaxed text-muted">
                  Your request details will appear here.
                </p>
              </div>
              <dl className="divide-y divide-line px-4">
                <LiveRow icon={LayoutGrid} label="Appliance" value={applianceType} />
                <LiveRow icon={Tag} label="Brand" value={brand} />
                <LiveRow icon={Hash} label="Model Number" value={modelNumber} />
                <LiveRow
                  icon={ShieldCheck}
                  label="Warranty Status"
                  value={warrantyStatus === "unknown" ? "" : warrantyText}
                />
                <LiveRow
                  icon={AlertCircle}
                  label="Reported Problem"
                  value={identifiedIssue?.label ?? ""}
                  placeholder="not identified"
                />
                <LiveRow
                  icon={Info}
                  label="Troubleshooting"
                  value={outcomeText}
                  placeholder="not started"
                />
                <LiveRow
                  icon={Wrench}
                  label="Service Type"
                  value={serviceTypeText}
                  placeholder="not set"
                />
                <LiveRow
                  icon={MapPin}
                  label={
                    serviceType === "pickup_return" ? "Pickup Address" : "Service Address"
                  }
                  value={serviceAddress}
                  placeholder="Not provided"
                />
                <LiveRow
                  icon={MapPin}
                  label="Map Location"
                  value={
                    serviceCoordinates
                      ? formatCoordinates(serviceCoordinates)
                      : locationUnconfirmed
                        ? "pin not confirmed"
                        : ""
                  }
                  placeholder="no pin placed"
                />
                <LiveRow
                  icon={CalendarClock}
                  label="Preferred Date & Time"
                  value={scheduleText}
                />
                <LiveRow
                  icon={Camera}
                  label="Photos"
                  value={photos.length ? `${photos.length}/6 attached` : ""}
                  placeholder="0/6 (optional)"
                />
              </dl>
              <p className="flex items-start gap-2 border-t border-line px-4 py-3 text-[11px] leading-relaxed text-muted">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                This summary updates automatically as you fill in the form.
              </p>
            </section>
          </div>
        </aside>
      </div>

      {/* Primary action. On a phone it is pinned to the bottom of the screen —
          the form is long and the button should never be a scroll away. */}
      <div className="spark-sticky-action md:hidden">
        <button
          type="submit"
          disabled={submitting || warrantyBlocked}
          aria-describedby={warrantyBlocked ? "submit-blocked-reason" : undefined}
          onClick={handleSubmitPointer}
          className="flex h-12 w-full cursor-pointer items-center justify-center rounded-xl bg-brand-500 px-6 text-sm font-semibold text-white shadow-sm transition duration-200 hover:bg-brand-600 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? (uploadingPhotos ? "Uploading photos..." : "Submitting...") : "Submit repair request"}
        </button>
        <p
          id="submit-blocked-reason"
          className="mt-1.5 text-center text-[11px] text-muted"
        >
          {warrantyBlocked
            ? "Tick the warranty acknowledgment in step 1 to enable this."
            : "Nothing is charged until you approve an estimate."}
        </p>
      </div>
    </form>
  );
}

/** One row of the summary. `dt`/`dd` inside the wrapping `dl` so the pairs are
 *  announced as term-then-definition rather than as loose text. */
function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-soft/60 px-3.5 py-2.5">
      <dt className="text-xs font-medium text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold text-ink">{value}</dd>
    </div>
  );
}

/**
 * One compact term/value pair in the desktop summary rail. Each row carries a
 * small icon so the rail can be scanned without reading every label. Unfilled
 * fields show a written placeholder ("not selected", "Not provided") rather
 * than pretending a default is a customer's deliberate choice.
 */
function LiveRow({
  icon: Icon,
  label,
  value,
  placeholder = "not selected",
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  placeholder?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <dt className="flex min-w-0 items-center gap-2 text-xs text-muted">
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted/80" aria-hidden="true" />
        <span className="truncate">{label}</span>
      </dt>
      <dd
        className={`min-w-0 break-words text-right text-xs font-semibold ${
          value ? "text-ink" : "text-muted/60"
        }`}
      >
        {value || placeholder}
      </dd>
    </div>
  );
}
