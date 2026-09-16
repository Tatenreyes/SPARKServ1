import { NextResponse, type NextRequest } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { getCurrentUser, AuthError } from "@/lib/auth";
import { assignTechnician } from "@/lib/assignment";

// POST /api/service-requests — customer submits a new appliance issue.
// Immediately triggers the fair ROTATION-based assignment engine (see
// lib/assignment.ts) — the customer never browses or picks a technician.
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) throw new AuthError("Not authenticated", 401);
    if (user.role !== "customer") {
      throw new AuthError("Only customers can submit service requests", 403);
    }

    const body = await request.json();
    const { appliance_type, issue_description, location, latitude, longitude, chatbot_resolved } = body;

    if (!appliance_type || !issue_description || !location) {
      return NextResponse.json(
        { error: "appliance_type, issue_description, and location are required" },
        { status: 400 }
      );
    }

    const supabase = createClient();
    const { data: created, error } = await supabase
      .from("service_requests")
      .insert({
        customer_id: user.id,
        appliance_type,
        issue_description,
        location,
        latitude: latitude ?? null,
        longitude: longitude ?? null,
        chatbot_resolved: Boolean(chatbot_resolved),
        status: "open",
      })
      .select()
      .single();

    if (error) throw error;

    // Assignment runs with the service-role client since it needs to read
    // across every technician's row and write offer/queue history, which
    // normal customer RLS intentionally doesn't allow.
    const serviceRoleClient = createServiceRoleClient();
    const assigned = await assignTechnician(serviceRoleClient, created);

    let assignedTechnician = null;
    if (assigned.assigned_technician_id) {
      const { data: tech } = await serviceRoleClient
        .from("users")
        .select("id, name")
        .eq("id", assigned.assigned_technician_id)
        .single();
      assignedTechnician = tech ?? null;
    }

    return NextResponse.json({ data: assigned, assigned_technician: assignedTechnician }, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}

// GET /api/service-requests — list requests scoped to the caller's role
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) throw new AuthError("Not authenticated", 401);

    const supabase = createClient();
    let query = supabase
      .from("service_requests")
      .select("*")
      .order("created_at", { ascending: false });

    if (user.role === "customer") {
      query = query.eq("customer_id", user.id);
    } else if (user.role === "technician") {
      // Technicians no longer browse open requests — they only see what
      // the queue has specifically offered/assigned to them.
      query = query.eq("assigned_technician_id", user.id);
    }
    // admin / super_admin see everything — RLS + no extra filter

    const { data, error } = await query;
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
