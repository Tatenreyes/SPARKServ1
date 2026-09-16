"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { NotificationRow } from "@/types/database";

export function useRealtimeNotifications(userId: string, initial: NotificationRow[] = []) {
  const [notifications, setNotifications] = useState<NotificationRow[]>(initial);

  useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel(`notifications:user:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          setNotifications((current) => [payload.new as NotificationRow, ...current]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  return [notifications, setNotifications] as const;
}
