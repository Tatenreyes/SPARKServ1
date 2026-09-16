"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import type { SupportTicketRow, TicketStatus, TicketPriority } from "@/types/database";

interface UserInfo {
  id: string;
  name: string;
  email: string;
}

const STATUS_OPTIONS: TicketStatus[] = ["open", "in_progress", "resolved", "closed"];

const PRIORITY_COLOR: Record<TicketPriority, string> = {
  low: "bg-ink/5 text-ink/50",
  medium: "bg-brand-50 text-brand-600",
  high: "bg-spark-50 text-spark-700",
  critical: "bg-alert-50 text-alert-600",
};

export default function AdminSupportTicketsClient({
  initialTickets,
  userInfo,
}: {
  initialTickets: SupportTicketRow[];
  userInfo: Record<string, UserInfo>;
}) {
  const [tickets, setTickets] = useState(initialTickets);
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const filtered = tickets.filter((t) => {
    if (!search) return true;
    const u = userInfo[t.user_id];
    const haystack = `${t.subject} ${u?.name ?? ""} ${u?.email ?? ""}`.toLowerCase();
    return haystack.includes(search.toLowerCase());
  });

  async function updateStatus(id: string, status: TicketStatus) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/support-tickets/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const json = await res.json();
      if (res.ok) {
        setTickets((prev) => prev.map((t) => (t.id === id ? json.data : t)));
      }
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mt-6">
      <div className="mb-3 flex items-center gap-2 rounded-lg border border-ink/15 bg-white px-3 py-2">
        <Search className="h-4 w-4 text-ink/35" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search tickets by ID, subject, or customer..."
          className="w-full text-sm outline-none"
        />
      </div>

      <div className="overflow-x-auto rounded-card border border-ink/8 bg-white shadow-card">
        <table className="min-w-[720px] w-full text-left text-sm">
          <thead className="border-b border-ink/8 bg-canvas text-xs uppercase tracking-wide text-ink/40">
            <tr>
              <th className="px-4 py-3 font-medium">Ticket</th>
              <th className="px-4 py-3 font-medium">Customer</th>
              <th className="px-4 py-3 font-medium">Type &amp; Priority</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {!filtered.length ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-sm text-ink/40">
                  No tickets found.
                </td>
              </tr>
            ) : (
              filtered.map((t) => {
                const u = userInfo[t.user_id];
                return (
                  <tr key={t.id} className="border-b border-ink/5 last:border-0">
                    <td className="px-4 py-3">
                      <p className="font-medium text-ink">{t.subject}</p>
                      <p className="mt-0.5 text-xs text-ink/35">
                        {new Date(t.created_at).toLocaleDateString()}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-ink/70">{u?.name ?? "—"}</p>
                      <p className="text-xs text-ink/40">{u?.email}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-xs capitalize text-ink/60">{t.type.replace("_", " ")}</p>
                      <span
                        className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${PRIORITY_COLOR[t.priority]}`}
                      >
                        {t.priority}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={t.status}
                        disabled={busyId === t.id}
                        onChange={(e) => updateStatus(t.id, e.target.value as TicketStatus)}
                        className="rounded-lg border border-ink/15 px-2 py-1 text-xs capitalize"
                      >
                        {STATUS_OPTIONS.map((s) => (
                          <option key={s} value={s} className="capitalize">
                            {s.replace("_", " ")}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
