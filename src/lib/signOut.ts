"use client";

import { createClient } from "@/lib/supabase/client";

/**
 * The single sign-out path for every authenticated surface.
 *
 * The dashboard shell exposes sign-out in two places (the topbar user menu and
 * the sidebar footer); duplicating the Supabase call in both meant a fix could
 * silently miss one of them.
 *
 * Typed structurally rather than against `AppRouterInstance` so this stays
 * importable from anywhere without pulling Next's internal router types in.
 */
export async function signOut(router: { push: (href: string) => void; refresh: () => void }) {
  const supabase = createClient();
  await supabase.auth.signOut();
  router.push("/login");
  router.refresh();
}
