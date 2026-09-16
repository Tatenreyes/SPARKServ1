import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, AuthError } from "@/lib/auth";

// POST /api/appliances — customer adds an appliance to their inventory
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) throw new AuthError("Not authenticated", 401);

    const body = await request.json();
    const { name, appliance_type, brand, model, purchase_date, notes } = body;

    if (!name || !appliance_type) {
      return NextResponse.json(
        { error: "name and appliance_type are required" },
        { status: 400 }
      );
    }

    const supabase = createClient();
    const { data, error } = await supabase
      .from("appliances")
      .insert({
        customer_id: user.id,
        name,
        appliance_type,
        brand: brand ?? null,
        model: model ?? null,
        purchase_date: purchase_date ?? null,
        notes: notes ?? null,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ data }, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}

// GET /api/appliances — list the caller's own appliances
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) throw new AuthError("Not authenticated", 401);

    const supabase = createClient();
    const { data, error } = await supabase
      .from("appliances")
      .select("*")
      .eq("customer_id", user.id)
      .order("created_at", { ascending: false });

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
