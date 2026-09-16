"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { MessageRow } from "@/types/database";

/**
 * Subscribes to Supabase Realtime for new messages on a given booking,
 * appending them to local state as they arrive. Pass an initial list
 * (fetched server-side) so the thread isn't empty on first paint.
 */
export function useRealtimeMessages(bookingId: string, initialMessages: MessageRow[] = []) {
  const [messages, setMessages] = useState<MessageRow[]>(initialMessages);

  useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel(`messages:booking:${bookingId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `booking_id=eq.${bookingId}`,
        },
        (payload) => {
          setMessages((current) => [...current, payload.new as MessageRow]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [bookingId]);

  return messages;
}
