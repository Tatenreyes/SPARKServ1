import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, AuthError } from "@/lib/auth";

/**
 * /api/technician-availability — a technician's own weekly availability windows
 * and time off.
 *
 * These are the "is this technician able to work at the requested time?" inputs:
 * a request whose window falls outside them is skipped FOR THAT REQUEST ONLY.
 * An empty window list means "no restriction" (see QUEUE-SYSTEM.md).
 *
 * Everything runs on the user-scoped client, so RLS restricts every read and
 * write to the caller's own rows — a technician cannot edit another's schedule.
 */

const TIME_PATTERN = /^\d{2}:\d{2}(:\d{2})?$/;

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) throw new AuthError("Not authenticated", 401);
    if (user.role !== "technician") {
      throw new AuthError("Only technicians have availability settings", 403);
    }

    const supabase = createClient();
    const [windows, timeOff, areas] = await Promise.all([
      supabase
        .from("technician_availability")
        .select("*")
        .eq("technician_id", user.id)
        .order("weekday", { ascending: true })
        .order("start_time", { ascending: true }),
      supabase
        .from("technician_time_off")
        .select("*")
        .eq("technician_id", user.id)
        .gte("ends_at", new Date().toISOString())
        .order("starts_at", { ascending: true }),
      supabase
        .from("technician_service_areas")
        .select("*")
        .eq("technician_id", user.id)
        .order("area", { ascending: true }),
    ]);

    if (windows.error) throw windows.error;
    if (timeOff.error) throw timeOff.error;
    if (areas.error) throw areas.error;

    return NextResponse.json({
      data: {
        windows: windows.data ?? [],
        time_off: timeOff.data ?? [],
        service_areas: areas.data ?? [],
      },
    });
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) throw new AuthError("Not authenticated", 401);
    if (user.role !== "technician") {
      throw new AuthError("Only technicians have availability settings", 403);
    }

    const body = await request.json();
    const action = String(body.action ?? "");
    const supabase = createClient();

    if (action === "add_window") {
      const weekday = Number(body.weekday);
      const start = String(body.start_time ?? "");
      const end = String(body.end_time ?? "");

      if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
        return NextResponse.json({ error: "weekday must be 0 (Sunday) to 6 (Saturday)" }, { status: 400 });
      }
      if (!TIME_PATTERN.test(start) || !TIME_PATTERN.test(end)) {
        return NextResponse.json({ error: "start_time and end_time must be HH:MM" }, { status: 400 });
      }
      if (end <= start) {
        return NextResponse.json({ error: "The window must end after it starts" }, { status: 400 });
      }

      const { data, error } = await supabase
        .from("technician_availability")
        .insert({ technician_id: user.id, weekday, start_time: start, end_time: end })
        .select()
        .single();
      if (error) throw error;
      return NextResponse.json({ data }, { status: 201 });
    }

    if (action === "remove_window") {
      const { error } = await supabase
        .from("technician_availability")
        .delete()
        .eq("id", String(body.id ?? ""))
        .eq("technician_id", user.id);
      if (error) throw error;
      return NextResponse.json({ data: { removed: true } });
    }

    if (action === "add_time_off") {
      const startsAt = new Date(String(body.starts_at ?? ""));
      const endsAt = new Date(String(body.ends_at ?? ""));
      if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) {
        return NextResponse.json({ error: "ends_at must be a valid time after starts_at" }, { status: 400 });
      }

      const { data, error } = await supabase
        .from("technician_time_off")
        .insert({
          technician_id: user.id,
          starts_at: startsAt.toISOString(),
          ends_at: endsAt.toISOString(),
          reason: typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : null,
        })
        .select()
        .single();
      if (error) throw error;
      return NextResponse.json({ data }, { status: 201 });
    }

    if (action === "remove_time_off") {
      const { error } = await supabase
        .from("technician_time_off")
        .delete()
        .eq("id", String(body.id ?? ""))
        .eq("technician_id", user.id);
      if (error) throw error;
      return NextResponse.json({ data: { removed: true } });
    }

    if (action === "add_area") {
      const area = String(body.area ?? "").trim();
      if (!area) {
        return NextResponse.json({ error: "Area name is required" }, { status: 400 });
      }
      // null appliance_type means "every appliance type I am qualified for",
      // which is how the queue reads it (technician_covers_area).
      const applianceType =
        typeof body.appliance_type === "string" && body.appliance_type.trim()
          ? body.appliance_type.trim()
          : null;

      const { data, error } = await supabase
        .from("technician_service_areas")
        .insert({ technician_id: user.id, appliance_type: applianceType, area })
        .select()
        .single();
      if (error) throw error;
      return NextResponse.json({ data }, { status: 201 });
    }

    if (action === "remove_area") {
      const { error } = await supabase
        .from("technician_service_areas")
        .delete()
        .eq("id", String(body.id ?? ""))
        .eq("technician_id", user.id);
      if (error) throw error;
      return NextResponse.json({ data: { removed: true } });
    }

    return NextResponse.json(
      {
        error:
          "action must be add_window, remove_window, add_time_off, remove_time_off, add_area or remove_area",
      },
      { status: 400 }
    );
  } catch (err) {
    return handleError(err);
  }
}

function handleError(err: unknown) {
  if (err instanceof AuthError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  // The three availability tables are created by migration_queue_redesign.sql.
  // Before it is applied, PostgREST reports them as missing and a blanket
  // "Unable to update availability" would send someone debugging the screen
  // when the real answer is "a migration has not been run".
  const code = (err as { code?: string } | null)?.code;
  if (code === "42P01" || code === "PGRST205") {
    return NextResponse.json(
      {
        error:
          "Availability storage is not installed yet — apply supabase/migration_queue_redesign.sql, then reload the schema cache.",
      },
      { status: 503 }
    );
  }

  console.error(err);
  return NextResponse.json({ error: "Unable to update availability" }, { status: 500 });
}
