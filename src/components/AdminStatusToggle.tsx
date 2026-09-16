"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AdminStatusToggle({
  userId,
  isActive,
}: {
  userId: string;
  isActive: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    try {
      await fetch(`/api/users/${userId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !isActive }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={toggle}
      disabled={busy}
      className={`rounded-full px-3 py-1 text-xs font-semibold disabled:opacity-50 ${
        isActive ? "bg-signal-50 text-signal-600" : "bg-alert-50 text-alert-600"
      }`}
    >
      {busy ? "..." : isActive ? "Active" : "Inactive"}
    </button>
  );
}
