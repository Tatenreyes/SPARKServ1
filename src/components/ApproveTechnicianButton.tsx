"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ApproveTechnicianButton({
  technicianId,
  approved,
}: {
  technicianId: string;
  approved: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function toggle() {
    setLoading(true);
    try {
      await fetch(`/api/technicians/${technicianId}/approve`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approve: !approved }),
      });
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={toggle}
      disabled={loading}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${
        approved
          ? "border border-ink/15 text-ink/80 hover:bg-canvas"
          : "bg-brand-500 text-white hover:bg-brand-600"
      }`}
    >
      {loading ? "Saving..." : approved ? "Revoke approval" : "Approve"}
    </button>
  );
}
