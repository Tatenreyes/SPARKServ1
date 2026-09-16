import { createServiceRoleClient } from "@/lib/supabase/server";
import ApproveTechnicianButton from "@/components/ApproveTechnicianButton";

export default async function AdminTechniciansPage() {
  const supabase = createServiceRoleClient();

  const { data: authUsers, error: authUsersError } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (authUsersError) throw authUsersError;

  const technicianAuthUsers = authUsers.users.filter(
    (authUser) => authUser.user_metadata?.role === "technician" && authUser.email
  );
  for (const authUser of technicianAuthUsers) {
    const { data: profile } = await supabase
      .from("users")
      .select("id, role")
      .eq("id", authUser.id)
      .maybeSingle();

    if (!profile) {
      await supabase.from("users").insert({
        id: authUser.id,
        name: String(authUser.user_metadata?.name ?? authUser.email?.split("@")[0]),
        email: authUser.email,
        role: "technician",
      });
    } else if (profile.role === "customer") {
      await supabase.from("users").update({ role: "technician" }).eq("id", authUser.id);
    }

    await supabase.from("technicians").upsert({ id: authUser.id }, { onConflict: "id" });
  }

  const { data: technicians, error: techniciansError } = await supabase
    .from("technicians")
    .select("*")
    .order("created_at", { ascending: false });

  if (techniciansError) throw techniciansError;

  const technicianIds = (technicians ?? []).map((t) => t.id);
  const { data: users, error: usersError } = await supabase
    .from("users")
    .select("id, name, email")
    .in("id", technicianIds.length ? technicianIds : ["00000000-0000-0000-0000-000000000000"]);

  if (usersError) throw usersError;

  const userMap = new Map((users ?? []).map((u) => [u.id, u]));

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-ink">Technicians</h1>
      {!technicians?.length ? (
        <p className="text-sm text-ink/50">No technician accounts yet.</p>
      ) : (
        <div className="space-y-3">
          {technicians.map((t) => {
            const u = userMap.get(t.id);
            return (
              <div
                key={t.id}
                className="flex flex-col items-start gap-3 rounded-card border border-ink/8 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="font-medium text-ink">{u?.name ?? "Unknown"}</p>
                  <p className="break-all text-xs text-ink/50">{u?.email}</p>
                  <p className="mt-1 text-xs text-ink/35">
                    {t.experience_years} yrs experience · rating {t.rating.toFixed(1)}
                  </p>
                </div>
                <ApproveTechnicianButton technicianId={t.id} approved={t.approved} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
