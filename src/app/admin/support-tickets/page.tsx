import { createServiceRoleClient } from "@/lib/supabase/server";
import AdminSupportTicketsClient from "@/components/AdminSupportTicketsClient";

export default async function AdminSupportTicketsPage() {
  const supabase = createServiceRoleClient();

  const { data: tickets } = await supabase
    .from("support_tickets")
    .select("*")
    .order("created_at", { ascending: false });

  const userIds = Array.from(new Set((tickets ?? []).map((t) => t.user_id)));
  const { data: users } = userIds.length
    ? await supabase.from("users").select("id, name, email").in("id", userIds)
    : { data: [] };

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-ink">Support tickets</h1>
      <p className="mt-1 text-sm text-ink/65">Manage customer inquiries and support requests.</p>
      <AdminSupportTicketsClient
        initialTickets={tickets ?? []}
        userInfo={Object.fromEntries((users ?? []).map((u) => [u.id, u]))}
      />
    </div>
  );
}
