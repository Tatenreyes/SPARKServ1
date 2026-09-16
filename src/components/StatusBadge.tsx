const STATUS_STYLES: Record<string, string> = {
  open: "bg-brand-50 text-brand-700 border border-brand-100",
  quoted: "bg-spark-50 text-spark-600 border border-spark-200",
  booked: "bg-brand-100 text-brand-700 border border-brand-200",
  pending: "bg-spark-50 text-spark-600 border border-spark-200",
  in_progress: "bg-brand-50 text-brand-700 border border-brand-200",
  awaiting_inspection: "bg-spark-50 text-spark-700 border border-spark-300",
  completed: "bg-signal-50 text-signal-600 border border-signal-200",
  resolved: "bg-signal-50 text-signal-600 border border-signal-200",
  closed: "bg-slate-100 text-slate-600 border border-slate-200",
  cancelled: "bg-alert-50 text-alert-600 border border-alert-200",
  rejected: "bg-alert-50 text-alert-600 border border-alert-200",
  accepted: "bg-signal-50 text-signal-600 border border-signal-200",
};

export default function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? "bg-slate-100 text-slate-600 border border-slate-200";
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold capitalize ${style}`}>
      {status.replace("_", " ")}
    </span>
  );
}
