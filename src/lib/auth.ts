import { createClient } from "@/lib/supabase/server";
import type { UserRole, UserRow } from "@/types/database";

/**
 * Fetches the currently authenticated user's full profile row
 * (including role) inside a Server Component / Route Handler.
 * Returns null if nobody is logged in.
 */
export async function getCurrentUser(): Promise<UserRow | null> {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from("users")
    .select("*")
    .eq("id", user.id)
    .single();

  if (!profile || !profile.is_active) return null;

  return profile as UserRow;
}

/**
 * Throws if the current user isn't logged in or isn't one of the allowed
 * roles. Use inside API routes as a guard clause:
 *
 *   const user = await requireRole(["admin", "super_admin"]);
 */
export async function requireRole(allowedRoles: UserRole[]): Promise<UserRow> {
  const user = await getCurrentUser();

  if (!user) {
    throw new AuthError("Not authenticated", 401);
  }

  if (!allowedRoles.includes(user.role)) {
    throw new AuthError("Not authorized for this action", 403);
  }

  return user;
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
