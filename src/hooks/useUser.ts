"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { UserRow } from "@/types/database";

export function useUser() {
  const [profile, setProfile] = useState<UserRow | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();

    async function loadProfile() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setProfile(null);
        setLoading(false);
        return;
      }

      const { data } = await supabase.from("users").select("*").eq("id", user.id).single();
      setProfile(data as UserRow | null);
      setLoading(false);
    }

    loadProfile();

    function handleProfileUpdated() {
      loadProfile();
    }

    window.addEventListener("profile-updated", handleProfileUpdated);

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      loadProfile();
    });

    return () => {
      subscription.unsubscribe();
      window.removeEventListener("profile-updated", handleProfileUpdated);
    };
  }, []);

  return { profile, loading };
}
