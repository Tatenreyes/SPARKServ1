import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AuthError, getCurrentUser } from "@/lib/auth";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) throw new AuthError("Not authenticated", 401);

    const supabase = createClient();
    const { data, error } = await supabase.from("users").select("*").eq("id", user.id).single();
    if (error) throw error;

    let technician = null;
    if (user.role === "technician") {
      const result = await supabase.from("technicians").select("specializations, experience_years, availability").eq("id", user.id).maybeSingle();
      technician = result.data;
    }

    return NextResponse.json({ data, technician });
  } catch (error) {
    return handleError(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) throw new AuthError("Not authenticated", 401);

    const body = await request.json();
    const userUpdate = {
      first_name: typeof body.first_name === "string" ? body.first_name.trim() : user.first_name,
      last_name: typeof body.last_name === "string" ? body.last_name.trim() : user.last_name,
      middle_initial: typeof body.middle_initial === "string" ? body.middle_initial.trim() || null : user.middle_initial,
      phone: typeof body.phone === "string" ? body.phone.trim() || null : user.phone,
      address: typeof body.address === "string" ? body.address.trim() || null : user.address,
    };

    if (!userUpdate.first_name && !userUpdate.last_name) {
      return NextResponse.json({ error: "First name or last name is required" }, { status: 400 });
    }

    const supabase = createClient();
    const { data, error } = await supabase.from("users").update(userUpdate).eq("id", user.id).select("*").single();
    if (error) throw error;

    let technician = null;
    if (user.role === "technician") {
      const technicianUpdate = {
        specializations: Array.isArray(body.specializations) ? body.specializations.filter((item: unknown): item is string => typeof item === "string" && !!item.trim()).map((item: string) => item.trim()) : undefined,
        experience_years: typeof body.experience_years === "number" ? Math.max(0, Math.floor(body.experience_years)) : undefined,
        availability: typeof body.availability === "boolean" ? body.availability : undefined,
      };
      const result = await supabase.from("technicians").update(technicianUpdate).eq("id", user.id).select("specializations, experience_years, availability").single();
      if (result.error) throw result.error;
      technician = result.data;
    }

    return NextResponse.json({ data, technician });
  } catch (error) {
    return handleError(error);
  }
}

function handleError(error: unknown) {
  if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error(error);
  return NextResponse.json({ error: "Unable to update profile" }, { status: 500 });
}
