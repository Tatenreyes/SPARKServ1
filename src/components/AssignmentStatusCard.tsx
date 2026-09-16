import { Loader2, CheckCircle2, Clock } from "lucide-react";
import type { AssignmentStatus } from "@/types/database";

interface AssignedTechnicianInfo {
  id: string;
  name: string;
}

export default function AssignmentStatusCard({
  status,
  applianceType,
  technician,
  onBackToAppliances,
}: {
  status: AssignmentStatus;
  applianceType: string;
  technician: AssignedTechnicianInfo | null;
  onBackToAppliances?: () => void;
}) {
  if (status === "matching" || status === "offered") {
    return (
      <div className="flex flex-col items-center gap-3 rounded-card border border-ink/8 bg-white p-8 text-center shadow-card">
        <Loader2 className="h-6 w-6 animate-spin text-brand-500" />
        <p className="font-medium text-ink">SPARKServ is finding you a technician...</p>
        <p className="text-sm text-ink/50">This usually only takes a moment.</p>
      </div>
    );
  }

  if (status === "waiting") {
    return (
      <div className="rounded-card border border-spark-400/30 bg-spark-50 p-6 text-center">
        <Clock className="mx-auto h-6 w-6 text-spark-600" />
        <p className="mt-2 font-medium text-ink">No technicians available right now</p>
        <p className="mt-1 text-sm text-ink/60">
          There are currently no technicians available for{" "}
          <span className="capitalize">{applianceType.replace("_", " ")}</span> repairs in your
          area. Your request is waiting for an available technician — we&apos;ll match you
          automatically as soon as one is.
        </p>
        {onBackToAppliances && (
          <button
            onClick={onBackToAppliances}
            className="mt-4 rounded-full border border-ink/15 px-4 py-2 text-sm font-medium text-ink/70 hover:bg-white"
          >
            Back to appliance selection
          </button>
        )}
      </div>
    );
  }

  // accepted
  if (technician) {
    return (
      <div className="rounded-card border border-signal-500/20 bg-signal-50/40 p-5">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-signal-600">
          <CheckCircle2 className="h-3.5 w-3.5" /> Technician Assigned
        </p>
        <p className="mt-2 font-display text-lg font-semibold text-ink">{technician.name}</p>
      </div>
    );
  }

  return null;
}
