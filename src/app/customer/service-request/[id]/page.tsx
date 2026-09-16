import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import RequestDetailClient from "@/components/RequestDetailClient";

export default async function ServiceRequestDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const supabase = createClient();

  const { data: request } = await supabase
    .from("service_requests")
    .select("*")
    .eq("id", params.id)
    .single();

  if (!request) notFound();

  const { data: estimates } = await supabase
    .from("estimates")
    .select("*")
    .eq("service_request_id", params.id)
    .order("created_at", { ascending: true });

  let assignedTechnician = null;
  if (request.assigned_technician_id) {
    const { data: tech } = await supabase
      .from("users")
      .select("id, name")
      .eq("id", request.assigned_technician_id)
      .single();
    assignedTechnician = tech ?? null;
  }

  return (
    <RequestDetailClient
      request={request}
      initialEstimates={estimates ?? []}
      assignedTechnician={assignedTechnician}
    />
  );
}
