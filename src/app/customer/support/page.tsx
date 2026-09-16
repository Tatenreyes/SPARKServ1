import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import SupportTicketsClient from "@/components/SupportTicketsClient";

export default async function SupportTicketsPage() {
  const user = await getCurrentUser();
  const supabase = createClient();

  const { data: tickets } = await supabase
    .from("support_tickets")
    .select("*")
    .eq("user_id", user!.id)
    .order("created_at", { ascending: false });

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-ink">Support tickets</h1>
      <p className="mt-1 text-sm text-ink/65">
        For account or platform issues — not appliance repairs. For a repair, use{" "}
        <span className="font-medium">Request Repair</span> instead.
      </p>
      <SupportTicketsClient initialTickets={tickets ?? []} />
    </div>
  );
}
