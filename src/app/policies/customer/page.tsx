const SECTIONS = [
  {
    title: "Service Request Policy",
    body: "Submitting a service request means describing your appliance issue as accurately as possible. SPARKServ uses this to match you with an eligible technician through the queue — inaccurate details may lead to a longer repair time or a revised estimate on-site.",
  },
  {
    title: "Troubleshooting Policy",
    body: "SPARKServ offers optional preliminary checks for the issue you identify. They are rule-based general guidance from a reviewed list, not a diagnosis and not a repair instruction — always prioritise your safety, stop if you are unsure, and skip them at any time. Reporting that a check worked is your own report; it does not mean the appliance has been professionally repaired, and you can still request a technician.",
  },
  {
    title: "Technician Assignment Policy",
    body: "SPARKServ assigns technicians automatically through a fair, rotation-based queue for each appliance type. Technicians take turns receiving job offers based on when they last took a job of that type — not by rating or experience. Customers do not browse or hand-pick a technician; this keeps opportunities fair for both new and experienced technicians. If no technician is currently eligible, your request waits and is matched automatically once one becomes available.",
  },
  {
    title: "Estimate Policy",
    body: "Once a technician accepts your request, they will send a preliminary cost estimate — the proposed work plus itemized labour, parts and any additional charges — before any work begins. You can approve it, decline it, or ask for a revision; the estimate is only a quotation based on what the technician knows so far, so an inspection may reveal more work. Approving an estimate does not book anything by itself: you choose the appointment time in the next step, and the slot is checked against your technician's schedule and capacity. If extra chargeable work is found later, your technician must send a revised estimate and you must approve that new version before the extra work proceeds — your earlier approval never covers a changed scope or price. Declining an estimate creates no booking.",
  },
  {
    title: "Cancellation Policy",
    body: "You may cancel a pending request or booking before a technician begins work. Cancellations after work has started should be discussed directly with your assigned technician via in-app messaging.",
  },
  {
    title: "Booking Policy",
    body: "Bookings are scheduled at a date/time you select after approving an estimate. Please be available at the scheduled location and time, or message your technician in advance if plans change.",
  },
  {
    title: "Appliance Inspection Policy",
    body: "After a technician marks a repair complete, you'll be asked to confirm the appliance is working properly before payment unlocks. If there's still a problem, you can report it directly instead of paying, which opens a support ticket for follow-up.",
  },
  {
    title: "Payment Policy",
    body: "Payment is submitted by the customer only, via GCash reference number, after confirming the repair. An administrator verifies each payment reference before it's marked confirmed.",
  },
  {
    title: "Refund / Dispute Policy",
    body: "If a repair doesn't resolve the reported issue, use the appliance inspection step to flag it instead of paying — this opens a support case reviewed by SPARKServ. Refund eligibility is assessed case by case.",
  },
  {
    title: "Customer Responsibilities",
    body: "Provide accurate appliance and location information, be reachable for scheduling, and communicate promptly with your assigned technician.",
  },
  {
    title: "Privacy & Data Handling",
    body: "SPARKServ stores the information necessary to operate the platform — your profile, requests, bookings, messages, and payment references. Data is not sold to third parties. Access is limited by role-based permissions enforced at the database level.",
  },
];

export default function CustomerPoliciesPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="font-display text-2xl font-semibold text-ink">SPARKServ Customer Policies</h1>
      <p className="mt-2 text-sm text-ink/60">
        These are SPARKServ&apos;s platform policies, presented here for review by the project
        owners. They describe how the platform is intended to operate rather than constituting
        binding legal terms.
      </p>
      <div className="mt-8 space-y-6">
        {SECTIONS.map((s) => (
          <section key={s.title}>
            <h2 className="font-display text-base font-semibold text-ink">{s.title}</h2>
            <p className="mt-1 text-sm text-ink/65">{s.body}</p>
          </section>
        ))}
      </div>
    </div>
  );
}
