import { createServiceRoleClient } from "@/lib/supabase/server";
import type { AssignmentStatus } from "@/types/database";

const ACTIVE_BOOKING_STATUSES = ["pending", "in_progress", "awaiting_inspection"];

type QueueTechnician = {
  id: string;
  name: string;
  lastAssignedAt: string | null;
  booked: boolean;
  queuePosition: number | null;
};

type ApplianceQueue = {
  type: string;
  technicians: QueueTechnician[];
  available: QueueTechnician[];
  booked: QueueTechnician[];
  mostRecentlyAssignedId: string | null;
};

const STATUS_LABEL: Record<AssignmentStatus, string> = {
  matching: "Matching",
  offered: "Offered",
  accepted: "Accepted",
  waiting: "Waiting",
};

const STATUS_COLOR: Record<AssignmentStatus, string> = {
  matching: "bg-ink/5 text-ink/50",
  offered: "bg-spark-50 text-spark-700",
  accepted: "bg-signal-50 text-signal-600",
  waiting: "bg-alert-50 text-alert-600",
};

export default async function AdminTechnicianQueuePage() {
  const supabase = createServiceRoleClient();

  const { data: requests } = await supabase
    .from("service_requests")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);

  const counts: Record<AssignmentStatus, number> = {
    matching: 0,
    offered: 0,
    accepted: 0,
    waiting: 0,
  };
  for (const r of requests ?? []) {
    const status = r.assignment_status as AssignmentStatus;
    counts[status] = (counts[status] ?? 0) + 1;
  }

  const technicianIds = Array.from(
    new Set((requests ?? []).map((r) => r.assigned_technician_id).filter(Boolean) as string[])
  );
  const { data: technicianUsers } = technicianIds.length
    ? await supabase.from("users").select("id, name").in("id", technicianIds)
    : { data: [] };
  const technicianMap = new Map((technicianUsers ?? []).map((t) => [t.id, t.name]));

  const { data: approvedTechnicians, error: approvedTechniciansError } = await supabase
    .from("technicians")
    .select("id, specializations, approved")
    .eq("approved", true);
  if (approvedTechniciansError) throw approvedTechniciansError;

  const approvedTechnicianIds = (approvedTechnicians ?? []).map((technician) => technician.id);
  const { data: approvedTechnicianUsers, error: approvedTechnicianUsersError } = approvedTechnicianIds.length
    ? await supabase
        .from("users")
        .select("id, name")
        .in("id", approvedTechnicianIds)
    : { data: [], error: null };
  if (approvedTechnicianUsersError) throw approvedTechnicianUsersError;

  const approvedTechnicianMap = new Map(
    (approvedTechnicianUsers ?? []).map((technician) => [technician.id, technician.name])
  );

  const applianceTypes = Array.from(
    new Set(
      (approvedTechnicians ?? []).flatMap((technician) =>
        (technician.specializations ?? [])
          .map((specialization: string) => specialization.trim().toLowerCase())
          .filter(Boolean)
      )
    )
  ).sort();

  const { data: queueRows } = await supabase
    .from("technician_queue_state")
    .select("*")
    .order("last_assigned_at", { ascending: true, nullsFirst: true });

  const queueByAppliance = new Map<string, { technician_id: string; last_assigned_at: string | null }[]>();
  for (const row of queueRows ?? []) {
    const key = row.appliance_type.trim().toLowerCase();
    const list = queueByAppliance.get(key) ?? [];
    list.push(row);
    queueByAppliance.set(key, list);
  }

  const { data: activeBookings, error: activeBookingsError } = approvedTechnicianIds.length
    ? await supabase
        .from("bookings")
        .select("technician_id")
        .in("technician_id", approvedTechnicianIds)
        .in("status", ACTIVE_BOOKING_STATUSES)
    : { data: [], error: null };
  if (activeBookingsError) throw activeBookingsError;

  const bookedTechnicianIds = new Set((activeBookings ?? []).map((booking) => booking.technician_id));

  const queueGroups: ApplianceQueue[] = applianceTypes.map((type) => {
    const queueState = new Map(
      (queueByAppliance.get(type) ?? []).map((row) => [row.technician_id, row.last_assigned_at])
    );
    const qualified = (approvedTechnicians ?? []).filter((technician) =>
      (technician.specializations ?? []).some(
        (specialization: string) => specialization.trim().toLowerCase() === type
      )
    );
    const technicians: QueueTechnician[] = qualified.map((technician) => ({
      id: technician.id,
      name: approvedTechnicianMap.get(technician.id) ?? "Unknown technician",
      lastAssignedAt: queueState.get(technician.id) ?? null,
      booked: bookedTechnicianIds.has(technician.id),
      queuePosition: null,
    }));
    const available = technicians
      .filter((technician) => !technician.booked)
      .sort(compareQueueOrder);
    const booked = technicians
      .filter((technician) => technician.booked)
      .sort(compareQueueOrder);
    available.forEach((technician, index) => {
      technician.queuePosition = index + 1;
    });
    const ordered = [...available, ...booked];
    const mostRecentlyAssigned = ordered
      .filter((technician) => technician.lastAssignedAt)
      .sort((a, b) =>
        new Date(b.lastAssignedAt as string).getTime() - new Date(a.lastAssignedAt as string).getTime()
      )[0];

    return {
      type,
      technicians: ordered,
      available,
      booked,
      mostRecentlyAssignedId: mostRecentlyAssigned?.id ?? null,
    };
  });

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-ink">Technician queue monitor</h1>
      <p className="mt-1 text-sm text-ink/65">
        Real-time visibility into the rotation-based assignment queue — every request&apos;s
        current matching state, and each appliance type&apos;s turn order.
      </p>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(Object.keys(counts) as AssignmentStatus[]).map((status) => (
          <div key={status} className="rounded-card border border-ink/8 bg-white p-3 shadow-card">
            <p className="font-display text-lg font-semibold text-ink">{counts[status]}</p>
            <p className="mt-0.5 text-xs text-ink/50">{STATUS_LABEL[status]}</p>
          </div>
        ))}
      </div>

      <div className="mt-8 overflow-x-auto rounded-card border border-ink/8 bg-white shadow-card">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-ink/8 bg-canvas text-xs uppercase tracking-wide text-ink/40">
            <tr>
              <th className="px-4 py-3 font-medium">Appliance</th>
              <th className="px-4 py-3 font-medium">Location</th>
              <th className="px-4 py-3 font-medium">Assignment Status</th>
              <th className="px-4 py-3 font-medium">Technician</th>
              <th className="px-4 py-3 font-medium">Submitted</th>
            </tr>
          </thead>
          <tbody>
            {!requests?.length ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-sm text-ink/40">
                  No requests yet.
                </td>
              </tr>
            ) : (
              requests.map((r) => {
                const status = r.assignment_status as AssignmentStatus;
                return (
                  <tr key={r.id} className="border-b border-ink/5 last:border-0">
                    <td className="px-4 py-3 capitalize text-ink">
                      {r.appliance_type.replace("_", " ")}
                    </td>
                    <td className="px-4 py-3 text-xs text-ink/50">{r.location}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_COLOR[status]}`}
                      >
                        {STATUS_LABEL[status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-ink/70">
                      {r.assigned_technician_id
                        ? (technicianMap.get(r.assigned_technician_id) ?? "—")
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-ink/50">
                      {new Date(r.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {queueGroups.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-3 font-display text-lg font-semibold text-ink">
            Rotation order by appliance type
          </h2>
          <p className="mb-4 text-sm text-ink/60">
            Available technicians are numbered in rotation order. Booked technicians remain visible
            below because they are temporarily unavailable for that appliance type.
          </p>
          <div className="grid gap-4 xl:grid-cols-2">
            {queueGroups.map((group) => {
              return (
                <div key={group.type} className="rounded-card border border-ink/8 bg-white p-4 shadow-card">
                  <p className="text-sm font-semibold capitalize text-ink">
                    {group.type.replace(/_/g, " ")}
                  </p>
                  <QueueSection
                    title="Available now"
                    technicians={group.available}
                    mostRecentlyAssignedId={group.mostRecentlyAssignedId}
                  />
                  {group.booked.length > 0 && (
                    <QueueSection
                      title="Currently booked"
                      technicians={group.booked}
                      mostRecentlyAssignedId={group.mostRecentlyAssignedId}
                      booked
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function compareQueueOrder(a: QueueTechnician, b: QueueTechnician) {
  if (!a.lastAssignedAt && !b.lastAssignedAt) return a.name.localeCompare(b.name);
  if (!a.lastAssignedAt) return -1;
  if (!b.lastAssignedAt) return 1;
  const timeDifference =
    new Date(a.lastAssignedAt).getTime() - new Date(b.lastAssignedAt).getTime();
  return timeDifference || a.name.localeCompare(b.name);
}

function QueueSection({
  title,
  technicians,
  mostRecentlyAssignedId,
  booked = false,
}: {
  title: string;
  technicians: QueueTechnician[];
  mostRecentlyAssignedId: string | null;
  booked?: boolean;
}) {
  return (
    <section className="mt-4 first:mt-3">
      <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-ink/45">{title}</h3>
      {!technicians.length ? (
        <p className="mt-2 text-xs text-ink/40">No technicians in this section.</p>
      ) : (
        <ol className="mt-2 space-y-2">
          {technicians.map((technician) => (
            <li
              key={technician.id}
              className={`flex items-start justify-between gap-3 rounded-lg border px-3 py-2 text-xs ${
                booked ? "border-ink/5 bg-ink/[0.025] text-ink/55" : "border-ink/8 bg-white text-ink/75"
              }`}
            >
              <div className="min-w-0">
                <p className="font-semibold text-ink">
                  {technician.queuePosition ? `${technician.queuePosition}. ` : ""}
                  {technician.name}
                  {technician.id === mostRecentlyAssignedId && (
                    <span className="ml-2 rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-semibold text-brand-600">
                      Most recently assigned
                    </span>
                  )}
                </p>
                <p className="mt-0.5 text-ink/45">
                  Last assigned: {formatLastAssigned(technician.lastAssignedAt)}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-full px-2 py-1 font-semibold ${
                  booked ? "bg-alert-50 text-alert-600" : "bg-signal-50 text-signal-600"
                }`}
              >
                {booked ? "Booked" : "Available"}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function formatLastAssigned(lastAssignedAt: string | null) {
  return lastAssignedAt ? new Date(lastAssignedAt).toLocaleString() : "Never";
}
