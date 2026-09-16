"use client";

import { useState } from "react";

export default function SystemSettingsClient({
  initialMaintenanceMode,
  initialAnnouncement,
}: {
  initialMaintenanceMode: boolean;
  initialAnnouncement: string;
}) {
  const [maintenanceMode, setMaintenanceMode] = useState(initialMaintenanceMode);
  const [announcement, setAnnouncement] = useState(initialAnnouncement);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save() {
    setSaving(true);
    setSaved(false);
    try {
      await Promise.all([
        fetch("/api/settings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: "maintenance_mode", value: String(maintenanceMode) }),
        }),
        fetch("/api/settings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: "platform_announcement", value: announcement }),
        }),
      ]);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-6 max-w-lg space-y-6">
      <div className="rounded-card border border-ink/8 bg-white p-5 shadow-card">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium text-ink">Maintenance mode</p>
            <p className="text-xs text-ink/50">
              Customers and technicians are redirected to a maintenance page. Admins are
              unaffected.
            </p>
          </div>
          <button
            onClick={() => setMaintenanceMode((m) => !m)}
            className={`h-6 w-11 shrink-0 rounded-full transition ${
              maintenanceMode ? "bg-alert-500" : "bg-ink/15"
            }`}
          >
            <span
              className={`block h-5 w-5 translate-y-0.5 rounded-full bg-white transition ${
                maintenanceMode ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
      </div>

      <div className="rounded-card border border-ink/8 bg-white p-5 shadow-card">
        <p className="font-medium text-ink">Platform announcement</p>
        <p className="text-xs text-ink/50">
          Shown as a banner on the customer dashboard. Leave blank to hide it.
        </p>
        <textarea
          rows={2}
          value={announcement}
          onChange={(e) => setAnnouncement(e.target.value)}
          placeholder="e.g. Scheduled maintenance this Sunday, 12AM–2AM"
          className="mt-2 w-full rounded-lg border border-ink/15 px-3 py-2 text-sm"
        />
      </div>

      <button
        onClick={save}
        disabled={saving}
        className="rounded-full bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-50"
      >
        {saving ? "Saving..." : saved ? "Saved" : "Save settings"}
      </button>
    </div>
  );
}
