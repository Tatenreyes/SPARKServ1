import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { Wrench, Star, Wallet, CalendarClock } from "lucide-react";

export default async function RepairHistoryPage() {
  const user = await getCurrentUser();
  const supabase = createClient();

  const { data: history } = await supabase
    .from("service_history")
    .select("*")
    .eq("customer_id", user!.id)
    .order("completed_at", { ascending: false });

  const { data: ratings } = await supabase
    .from("ratings")
    .select("rating")
    .eq("customer_id", user!.id);

  const totalRepairs = history?.length ?? 0;
  const totalSpent = (history ?? []).reduce((sum, h) => sum + (h.final_cost ?? 0), 0);
  const avgRating =
    ratings && ratings.length > 0
      ? ratings.reduce((sum, r) => sum + r.rating, 0) / ratings.length
      : null;
  const lastService = history && history.length > 0 ? history[0].completed_at : null;

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-ink">Repair history</h1>
      <p className="mt-1 text-sm text-ink/65">Every repair you&apos;ve completed through SPARKServ.</p>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard icon={<Wrench className="h-4 w-4" />} label="Total Repairs" value={String(totalRepairs)} />
        <SummaryCard
          icon={<Star className="h-4 w-4" />}
          label="Avg. Rating"
          value={avgRating != null ? `${avgRating.toFixed(1)}/5` : "—"}
        />
        <SummaryCard
          icon={<Wallet className="h-4 w-4" />}
          label="Total Spent"
          value={`₱${totalSpent.toFixed(0)}`}
        />
        <SummaryCard
          icon={<CalendarClock className="h-4 w-4" />}
          label="Last Service"
          value={lastService ? new Date(lastService).toLocaleDateString() : "—"}
        />
      </div>

      {!history?.length ? (
        <p className="mt-8 text-sm text-ink/50">No completed repairs yet.</p>
      ) : (
        <div className="mt-8 space-y-3">
          {history.map((h) => (
            <div key={h.id} className="rounded-card border border-ink/8 bg-white p-4 shadow-card">
              <div className="flex items-center justify-between">
                <p className="font-medium capitalize text-ink">
                  {h.appliance_type.replace("_", " ")}
                </p>
                <p className="text-xs text-ink/50">
                  {new Date(h.completed_at).toLocaleDateString()}
                </p>
              </div>
              {h.final_cost != null && (
                <p className="mt-1 text-sm text-ink/65">Cost: ₱{h.final_cost.toFixed(2)}</p>
              )}
              {h.summary && <p className="mt-1 text-sm text-ink/50">{h.summary}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-card border border-ink/8 bg-white p-3 shadow-card">
      <div className="flex items-center gap-1.5 text-ink/40">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <p className="mt-1.5 font-display text-lg font-semibold text-ink">{value}</p>
    </div>
  );
}
