"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import type { PaymentRow } from "@/types/database";

const STATUS_COLOR: Record<string, string> = {
  pending_verification: "bg-spark-50 text-spark-700",
  confirmed: "bg-signal-50 text-signal-600",
  rejected: "bg-alert-50 text-alert-600",
};

const STATUS_LABEL: Record<string, string> = {
  pending_verification: "Pending Verification",
  confirmed: "Confirmed",
  rejected: "Rejected",
};

export default function AdminPaymentsClient({
  initialPayments,
  customerNames,
}: {
  initialPayments: PaymentRow[];
  customerNames: Record<string, string>;
}) {
  const [payments, setPayments] = useState(initialPayments);
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const filtered = payments.filter((p) => {
    if (!search) return true;
    const name = customerNames[p.customer_id] ?? "";
    return (
      p.gcash_reference.toLowerCase().includes(search.toLowerCase()) ||
      name.toLowerCase().includes(search.toLowerCase())
    );
  });

  async function updateStatus(id: string, status: "confirmed" | "rejected") {
    setBusyId(id);
    try {
      const res = await fetch(`/api/payments/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const json = await res.json();
      if (res.ok) {
        setPayments((prev) => prev.map((p) => (p.id === id ? json.data : p)));
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
          placeholder="Search by reference or customer..."
          className="w-full text-sm outline-none"
        />
      </div>

      <div className="overflow-x-auto rounded-card border border-ink/8 bg-white shadow-card">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-ink/8 bg-canvas text-xs uppercase tracking-wide text-ink/40">
            <tr>
              <th className="px-4 py-3 font-medium">Customer</th>
              <th className="px-4 py-3 font-medium">Amount</th>
              <th className="px-4 py-3 font-medium">Reference #</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {!filtered.length ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-sm text-ink/40">
                  No transactions yet.
                </td>
              </tr>
            ) : (
              filtered.map((p) => (
                <tr key={p.id} className="border-b border-ink/5 last:border-0">
                  <td className="px-4 py-3 text-ink/70">{customerNames[p.customer_id] ?? "—"}</td>
                  <td className="px-4 py-3 font-medium text-ink">₱{p.amount.toFixed(2)}</td>
                  <td className="px-4 py-3 font-mono text-xs text-ink/60">{p.gcash_reference}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_COLOR[p.status]}`}
                    >
                      {STATUS_LABEL[p.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {p.status === "pending_verification" ? (
                      <div className="flex gap-2">
                        <button
                          onClick={() => updateStatus(p.id, "confirmed")}
                          disabled={busyId === p.id}
                          className="rounded-full bg-signal-500 px-3 py-1 text-xs font-semibold text-white hover:bg-signal-600 disabled:opacity-50"
                        >
                          Confirm
                        </button>
                        <button
                          onClick={() => updateStatus(p.id, "rejected")}
                          disabled={busyId === p.id}
                          className="rounded-full border border-alert-500/30 px-3 py-1 text-xs font-semibold text-alert-500 hover:bg-alert-50 disabled:opacity-50"
                        >
                          Reject
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-ink/35">—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
