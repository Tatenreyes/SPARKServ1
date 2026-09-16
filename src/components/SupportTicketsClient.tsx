"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import type { SupportTicketRow, TicketType, TicketPriority } from "@/types/database";
import StatusBadge from "@/components/StatusBadge";

const TYPE_OPTIONS: { value: TicketType; label: string }[] = [
  { value: "product_inquiry", label: "Product Inquiry" },
  { value: "billing_inquiry", label: "Billing Inquiry" },
  { value: "technical_issue", label: "Technical Issue" },
  { value: "other", label: "Other" },
];

const PRIORITY_OPTIONS: TicketPriority[] = ["low", "medium", "high", "critical"];

const PRIORITY_COLOR: Record<TicketPriority, string> = {
  low: "bg-ink/5 text-ink/50",
  medium: "bg-brand-50 text-brand-600",
  high: "bg-spark-50 text-spark-700",
  critical: "bg-alert-50 text-alert-600",
};

export default function SupportTicketsClient({
  initialTickets,
}: {
  initialTickets: SupportTicketRow[];
}) {
  const [tickets, setTickets] = useState(initialTickets);
  const [showForm, setShowForm] = useState(false);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [type, setType] = useState<TicketType>("technical_issue");
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
          onClick={() => setShowForm(true)}
          className="rounded-full bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600"
        >
          + New ticket
        </button>
      ) : (
        <form
          onSubmit={handleSubmit}
          className="mb-6 max-w-lg space-y-3 rounded-card border border-ink/8 bg-white p-4 shadow-card"
        >
          <div>
            <label className="mb-1 block text-sm font-medium text-ink/80">Subject</label>
            <input
              required
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Summary of the issue"
              className="w-full rounded-lg border border-ink/15 px-3 py-2 text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink/80">Ticket type</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as TicketType)}
                className="w-full rounded-lg border border-ink/15 px-3 py-2 text-sm"
              >
                {TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink/80">Priority</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as TicketPriority)}
                className="w-full rounded-lg border border-ink/15 px-3 py-2 text-sm"
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
            <label className="mb-1 block text-sm font-medium text-ink/80">
              Detailed description
            </label>
            <textarea
              required
              rows={3}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Describe your issue in detail..."
              className="w-full rounded-lg border border-ink/15 px-3 py-2 text-sm"
            />
          </div>
          {error && <p className="text-sm text-alert-500">{error}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={submitting}
              className="rounded-full bg-brand-500 px-4 py-1.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-50"
            >
              {submitting ? "Sending..." : "Submit ticket"}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-full border border-ink/15 px-4 py-1.5 text-sm font-medium text-ink/70"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {tickets.length > 0 && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-ink/15 bg-white px-3 py-2">
          <Search className="h-4 w-4 text-ink/35" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tickets by subject..."
            className="w-full text-sm outline-none"
          />
        </div>
      )}

      {!filtered.length ? (
        <p className="text-sm text-ink/50">No tickets yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-card border border-ink/8 bg-white shadow-card">
          <table className="min-w-[720px] w-full text-left text-sm">
            <thead className="border-b border-ink/8 bg-canvas text-xs uppercase tracking-wide text-ink/40">
              <tr>
                <th className="px-4 py-3 font-medium">Ticket</th>
                <th className="px-4 py-3 font-medium">Type &amp; Priority</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <tr key={t.id} className="border-b border-ink/5 last:border-0">
                  <td className="px-4 py-3">
                    <p className="font-medium text-ink">{t.subject}</p>
                    <p className="mt-0.5 max-w-md text-xs text-ink/50">{t.message}</p>
                    <p className="mt-0.5 text-[11px] text-ink/35">
                      {new Date(t.created_at).toLocaleDateString()}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-xs capitalize text-ink/60">
                      {t.type.replace("_", " ")}
                    </p>
                    <span
                      className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${PRIORITY_COLOR[t.priority]}`}
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
      )}
    </div>
  );
}
