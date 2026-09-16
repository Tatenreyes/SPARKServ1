import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { sendPushToUser } from "@/lib/push";

interface NotifyOptions {
  userId: string;
  type: string;
  title: string;
  body?: string;
  link?: string;
}

/**
 * Single entry point for notifying a user — inserts the in-app notification
 * row (shows in the bell icon, real-time) and fires a browser push in
 * parallel. Call this with a service-role client; notifications are always
 * system-generated, never a direct user action.
 */
export async function notify(supabase: SupabaseClient<Database>, options: NotifyOptions) {
  const { userId, type, title, body, link } = options;

  await supabase.from("notifications").insert({
    user_id: userId,
    type,
    title,
    body: body ?? null,
    link: link ?? null,
  });

  // Push failures shouldn't break the calling flow (e.g. don't fail a
  // technician's job acceptance just because a push notification didn't send).
  sendPushToUser(supabase, userId, { title, body: body ?? "", link }).catch((err) =>
    console.error("Push notification failed:", err)
  );
}
