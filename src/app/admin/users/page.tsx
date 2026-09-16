import { createServiceRoleClient } from "@/lib/supabase/server";
import UserManagementClient from "@/components/UserManagementClient";

export default async function AdminUsersPage() {
  const supabase = createServiceRoleClient();

  const { data: users } = await supabase
    .from("users")
    .select("*")
    .order("created_at", { ascending: false });

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-ink">User management</h1>
      <p className="mt-1 text-sm text-ink/65">Manage accounts and control access roles.</p>
      <UserManagementClient initialUsers={users ?? []} />
    </div>
  );
}
