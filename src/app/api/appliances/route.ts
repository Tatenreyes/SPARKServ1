import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, AuthError } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) throw new AuthError("Not authenticated", 401);

    const supabase = createClient();
    const searchParams = request.nextUrl.searchParams;
    const applianceId = searchParams.get("id");

    if (applianceId) {
      const { data, error } = await supabase
        .from("appliances")
        .select("*")
        .eq("id", applianceId)
        .eq("customer_id", user.id)
        .single();

      if (error || !data) {
        return NextResponse.json({ error: "Appliance not found" }, { status: 404 });
      }
      return NextResponse.json({ data });
    }

    const { data, error } = await supabase
      .from("appliances")
      .select("*")
      .eq("customer_id", user.id)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return NextResponse.json({ data: data ?? [] });
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) throw new AuthError("Not authenticated", 401);
    if (user.role !== "customer") {
      throw new AuthError("Only customers can manage appliances", 403);
    }

    const body = await request.json();
    const {
      appliance_type,
      brand,
      model_number,
      serial_number,
      purchase_date,
      warranty_status,
      warranty_type,
      warranty_expiry_date,
      warranty_proof_url,
      notes,
    } = body;

    if (!appliance_type) {
      return NextResponse.json({ error: "appliance_type is required" }, { status: 400 });
    }

    const supabase = createClient();
    const { data, error } = await supabase
      .from("appliances")
      .insert({
        customer_id: user.id,
        appliance_type,
        brand: brand ?? null,
        model_number: model_number ?? null,
        serial_number: serial_number ?? null,
        purchase_date: purchase_date ?? null,
        warranty_status: warranty_status ?? "unknown",
        warranty_type: warranty_type ?? null,
        warranty_expiry_date: warranty_expiry_date ?? null,
        warranty_proof_url: warranty_proof_url ?? null,
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

function handleError(err: unknown) {
  if (err instanceof AuthError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error(err);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}
