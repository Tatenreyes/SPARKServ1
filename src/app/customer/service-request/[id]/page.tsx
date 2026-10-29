import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getServiceTimezone } from "@/lib/service-time";
import { applianceCoverage } from "@/lib/assignment-coverage";
import RequestDetailClient from "@/components/RequestDetailClient";

export default async function ServiceRequestDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const supabase = createClient();
  const serviceTimeZone = await getServiceTimezone(supabase);

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

  // The assignment card must be able to say "nobody covers this appliance yet"
  // rather than the neutral "waiting" copy: the two look identical otherwise, and
  // only one of them is worth waiting for. Asked only while the request has no
  // technician, and `null` (the check could not run) keeps the neutral wording.
  const qualifiedTechnicianAvailable = request.assigned_technician_id
    ? null
    : await applianceCoverage(request.appliance_type);

  return (
    <RequestDetailClient
      request={request}
      initialEstimates={estimates ?? []}
      assignedTechnician={assignedTechnician}
      serviceTimeZone={serviceTimeZone}
      qualifiedTechnicianAvailable={qualifiedTechnicianAvailable}
    />
  );
}
