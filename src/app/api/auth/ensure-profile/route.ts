import { NextResponse, type NextRequest } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";

// Fallback for environments where the Supabase auth trigger has not been deployed yet.
export async function POST(request: NextRequest) {
  try {
    const { userId } = await request.json();
    if (!userId || typeof userId !== "string") {
      return NextResponse.json({ error: "userId is required" }, { status: 400 });
    }

    const supabase = createServiceRoleClient();
    const { data: authUser, error: authError } = await supabase.auth.admin.getUserById(userId);
    if (authError || !authUser.user?.email) {
      return NextResponse.json({ error: "Auth user not found" }, { status: 404 });
    }

    const role = authUser.user.user_metadata?.role === "technician" ? "technician" : "customer";
    const name = String(
      authUser.user.user_metadata?.name ?? authUser.user.email.split("@")[0]
    );

    const { data: existingProfile, error: profileLookupError } = await supabase
      .from("users")
      .select("id, role")
      .eq("id", authUser.user.id)
      .maybeSingle();
    if (profileLookupError) throw profileLookupError;

    if (!existingProfile) {
      const { error: profileError } = await supabase.from("users").insert({
        id: authUser.user.id,
        name,
        email: authUser.user.email,
        role,
      });
      if (profileError) throw profileError;
    } else if (role === "technician" && existingProfile.role === "customer") {
      const { error: profileError } = await supabase
        .from("users")
        .update({ role: "technician" })
        .eq("id", authUser.user.id)
        .eq("role", "customer");
      if (profileError) throw profileError;
    }

    if (
      role === "technician" &&
      (existingProfile?.role === "technician" || existingProfile?.role === "customer" || !existingProfile)
    ) {
      const { error: technicianError } = await supabase
        .from("technicians")
        .upsert({ id: authUser.user.id }, { onConflict: "id" });
      if (technicianError) throw technicianError;
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Unable to create account profile" }, { status: 500 });
  }
}
