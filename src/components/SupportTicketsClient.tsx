"use client";

import { useState } from "react";
import { Plus, Search } from "lucide-react";
import type { SupportTicketRow, TicketType, TicketPriority } from "@/types/database";
import StatusBadge from "@/components/StatusBadge";

const TYPE_OPTIONS: { value: TicketType; label: string }[] = [
  { value: "product_inquiry", label: "Product Inquiry" },
  { value: "billing_inquiry", label: "Billing Inquiry" },
  { value: "technical_issue", label: "Technical Issue" },
  { value: "other", label: "Other" },
];

/**
 * Deep links used by the mobile Support hub.
 *
 * "Warranty concern" and "Feedback" are not separate destinations — they are the
 * same support form with the type and an opening line already chosen. Two extra
 * routes would have been two extra pages to keep in sync with one API; a preset
 * gives the customer the same head start without inventing a parallel workflow.
 */
export type SupportPreset = "warranty" | "feedback";

const PRESETS: Record<SupportPreset, { type: TicketType; subject: string }> = {
  warranty: { type: "technical_issue", subject: "Warranty concern — " },
  feedback: { type: "other", subject: "Feedback — " },
};

/** Shared field styling: 16px text on a phone so iOS Safari does not zoom the
 *  viewport on focus, back to 14px once there is a pointer. */
const FIELD =
  "w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-base sm:text-sm";

const PRIORITY_OPTIONS: TicketPriority[] = ["low", "medium", "high", "critical"];

const PRIORITY_COLOR: Record<TicketPriority, string> = {
  low: "bg-soft text-muted",
  medium: "bg-brand-soft text-brand-ink",
  high: "bg-brand-soft text-brand-ink",
  critical: "bg-alert-soft text-alert-ink",
};

export default function SupportTicketsClient({
  initialTickets,
  preset,
}: {
  initialTickets: SupportTicketRow[];
  /** Opens the form with a topic already chosen — see the mobile Support hub. */
  preset?: SupportPreset;
}) {
  const [tickets, setTickets] = useState(initialTickets);
  const [showForm, setShowForm] = useState(Boolean(preset));
  const [subject, setSubject] = useState(preset ? PRESETS[preset].subject : "");
  const [message, setMessage] = useState("");
  const [type, setType] = useState<TicketType>(
    preset ? PRESETS[preset].type : "technical_issue"
  );
  const [priority, setPriority] = useState<TicketPriority>("medium");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/support-tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, message, type, priority }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setTickets((prev) => [json.data, ...prev]);
      setSubject("");
      setMessage("");
      setShowForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to open ticket");
    } finally {
      setSubmitting(false);
    }
  }

  const filtered = tickets.filter(
    (t) =>
      !search ||
      t.subject.toLowerCase().includes(search.toLowerCase()) ||
      t.message.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="mt-6">
      {!showForm ? (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="mb-4 inline-flex h-11 cursor-pointer items-center gap-1.5 rounded-xl bg-brand-500 px-4 text-sm font-semibold text-white transition duration-200 hover:bg-brand-600"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          New ticket
        </button>
      ) : (
        <form
          onSubmit={handleSubmit}
          className="mb-6 max-w-lg space-y-4 rounded-card border border-line bg-surface p-4 shadow-[0_1px_2px_rgba(16,38,74,0.04)] sm:p-5"
        >
          <div>
            <label htmlFor="ticket-subject" className="mb-1 block text-sm font-medium text-ink/80">
              Subject
            </label>
            <input
              id="ticket-subject"
              required
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Summary of the issue"
              className={FIELD}
            />
          </div>
          {/* One column on a phone: two ~150px selects side by side is a pixel
              hunt, and the native picker opens either way. */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="ticket-type" className="mb-1 block text-sm font-medium text-ink/80">
                Ticket type
              </label>
              <select
                id="ticket-type"
                value={type}
                onChange={(e) => setType(e.target.value as TicketType)}
                className={FIELD}
              >
                {TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                htmlFor="ticket-priority"
                className="mb-1 block text-sm font-medium text-ink/80"
              >
                Priority
              </label>
              <select
                id="ticket-priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value as TicketPriority)}
                className={FIELD}
              >
                {PRIORITY_OPTIONS.map((p) => (
                  <option key={p} value={p} className="capitalize">
                    {p}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="ticket-message" className="mb-1 block text-sm font-medium text-ink/80">
              Detailed description
            </label>
            <textarea
              id="ticket-message"
              required
              rows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Describe your issue in detail..."
              className={FIELD}
            />
          </div>
          {error && <p className="text-sm text-alert-ink">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex h-11 cursor-pointer items-center rounded-xl bg-brand-500 px-5 text-sm font-semibold text-white transition duration-200 hover:bg-brand-600 disabled:opacity-50"
            >
              {submitting ? "Sending..." : "Submit ticket"}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="inline-flex h-11 cursor-pointer items-center rounded-xl border border-line px-5 text-sm font-medium text-ink/70 transition duration-200 hover:bg-soft"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {tickets.length > 0 && (
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2.5">
          <Search className="h-4 w-4 shrink-0 text-muted/80" aria-hidden="true" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tickets by subject..."
            aria-label="Search tickets"
            className="w-full bg-transparent text-base outline-none sm:text-sm"
          />
        </div>
      )}

      {!filtered.length ? (
        <div className="rounded-card border border-dashed border-line px-5 py-10 text-center">
          <p className="text-sm font-medium text-ink">No tickets yet</p>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            {search
              ? "Nothing matches that search."
              : "Open a ticket and our team will reply here."}
          </p>
        </div>
      ) : (
        <>
          {/* Phone: one card per ticket. The old `min-w-[720px]` table forced a
              sideways scroll on every phone, which pushed the status column —
              the only thing a customer actually checks — off screen. */}
          <ul className="space-y-3 md:hidden">
            {filtered.map((t) => (
              <li
                key={t.id}
                className="rounded-card border border-line bg-surface p-4 shadow-[0_1px_2px_rgba(16,38,74,0.04)]"
              >
                <p className="text-sm font-semibold text-ink">{t.subject}</p>
                <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted">
                  {t.message}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <StatusBadge status={t.status} size="sm" withDot />
                  <span
                    className={`rounded-full px-2.5 py-1 text-[10px] font-semibold capitalize ${
                      PRIORITY_COLOR[t.priority]
                    }`}
                  >
                    {t.priority} priority
                  </span>
                  <span className="text-[11px] capitalize text-muted">
                    {t.type.replace(/_/g, " ")}
                  </span>
                </div>
                <p className="mt-2 text-[11px] text-muted">
                  Opened{" "}
                  {new Date(t.created_at).toLocaleDateString("en-US", {
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  })}
                </p>
              </li>
            ))}
          </ul>

          <div className="hidden overflow-x-auto rounded-card border border-line bg-surface shadow-[0_1px_2px_rgba(16,38,74,0.04)] md:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-canvas text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-3 font-medium">Ticket</th>
                  <th className="px-4 py-3 font-medium">Type &amp; Priority</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((t) => (
                  <tr key={t.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-3">
                      <p className="font-medium text-ink">{t.subject}</p>
                      <p className="mt-0.5 max-w-md text-xs text-muted">{t.message}</p>
                      <p className="mt-0.5 text-[11px] text-muted/80">
                        {new Date(t.created_at).toLocaleDateString()}
                       </p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-xs capitalize text-ink/60">
                        {t.type.replace(/_/g, " ")}
                      </p>
                      <span
                        className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${
                          PRIORITY_COLOR[t.priority]
                        }`}
                      >
                        {t.priority}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={t.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
