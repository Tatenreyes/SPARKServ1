import { createServiceRoleClient } from "@/lib/supabase/server";
import RoleControl from "@/components/RoleControl";
import AdminStatusToggle from "@/components/AdminStatusToggle";

export default async function SuperAdminAdminsPage() {
  const supabase = createServiceRoleClient();

  const { data: allUsers } = await supabase
    .from("users")
    .select("*")
    .order("created_at", { ascending: false });

  const admins = (allUsers ?? []).filter((u) => u.role === "admin" || u.role === "super_admin");
  const others = (allUsers ?? []).filter((u) => u.role !== "admin" && u.role !== "super_admin");

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-ink">Administrators</h1>
      <p className="mt-1 text-sm text-ink/65">
        Promote a trusted account to admin, or demote/deactivate an existing one. Changes
        take effect immediately.
      </p>

      <section className="mt-6">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink/40">
          Current administrators
        </h2>
        <div className="space-y-2">
          {!admins.length ? (
            <p className="text-sm text-ink/50">No administrator accounts yet.</p>
          ) : (
            admins.map((u) => (
              <div
                key={u.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-ink/8 bg-white p-4 shadow-card"
              >
                <div>
                  <p className="font-medium text-ink">{u.name}</p>
                  <p className="text-xs text-ink/50">{u.email}</p>
                </div>
                <div className="flex items-center gap-2">
                  <AdminStatusToggle userId={u.id} isActive={u.is_active} />
                  <RoleControl userId={u.id} currentRole={u.role} />
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink/40">
          Everyone else — promote to admin
        </h2>
        <div className="space-y-2">
          {others.map((u) => (
            <div
              key={u.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-ink/8 bg-white p-4 shadow-card"
            >
              <div>
                <p className="font-medium text-ink">{u.name}</p>
                <p className="text-xs text-ink/50">
                  {u.email} · <span className="capitalize">{u.role}</span>
                </p>
              </div>
              <RoleControl userId={u.id} currentRole={u.role} />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
