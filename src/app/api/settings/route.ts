import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, requireRole, AuthError } from "@/lib/auth";

// GET /api/settings — anyone authenticated can read (RLS also allows public read)
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) throw new AuthError("Not authenticated", 401);

    const supabase = createClient();
    const { data, error } = await supabase.from("system_settings").select("*");
    if (error) throw error;

    return NextResponse.json({ data });
  } catch (err) {
    return handleError(err);
  }
}

// PATCH /api/settings — admin/super_admin updates one key
export async function PATCH(request: NextRequest) {
  try {
    const user = await requireRole(["admin", "super_admin"]);

    const { key, value } = await request.json();
    if (!key) {
      return NextResponse.json({ error: "key is required" }, { status: 400 });
    }

    const supabase = createClient();
    const { data, error } = await supabase
      .from("system_settings")
      .update({ value: value ?? "", updated_at: new Date().toISOString(), updated_by: user.id })
      .eq("key", key)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ data });
  } catch (err) {
    return handleError(err);
  }
}

function handleError(err: unknown) {
  if (err instanceof AuthError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error(err);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}
