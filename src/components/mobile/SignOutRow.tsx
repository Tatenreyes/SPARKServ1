"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import LoadingScreen from "@/components/LoadingScreen";
import { signOut } from "@/lib/signOut";

/**
 * "Log out", as a row in the mobile Account hub.
 *
 * The topbar's user menu already offers this, but on a phone that menu is a
 * two-tap detour behind a 36px avatar; the Account tab is where people look for
 * it. Same `signOut` helper as the topbar and the sidebar, so the three cannot
 * drift in behaviour.
 */
export default function SignOutRow() {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  return (
    <>
      {signingOut && <LoadingScreen message="Signing you out..." />}
      <button
        type="button"
        onClick={async () => {
          setSigningOut(true);
          await signOut(router);
        }}
        className="flex min-h-[64px] w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition duration-200 hover:bg-alert-soft sm:px-5"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-alert-soft text-alert-ink">
          <LogOut className="h-5 w-5" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-alert-ink">Log out</span>
          <span className="mt-0.5 block text-xs text-muted">
            End this session on this device
          </span>
        </span>
      </button>
    </>
  );
}
