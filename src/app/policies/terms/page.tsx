import PolicyLayout, { type PolicySection } from "@/components/PolicyLayout";

const SECTIONS: PolicySection[] = [
  {
    title: "Using SPARKServ",
    body: "You need an account to file a repair request or accept work. You are responsible for the accuracy of the information on that account, and for keeping your password to yourself. One account per person; accounts may not be shared or sold.",
  },
  {
    title: "Customers",
    body: "Describe the appliance and the fault as accurately as you can — the assignment engine uses those details to decide which technicians are qualified, and an inaccurate description is the most common cause of a revised estimate on site. You must be able to receive the technician at the address you provide, and you approve the estimate before any work begins.",
  },
  {
    title: "Technicians",
    body: "Technician accounts are reviewed and approved by an administrator before they can receive work. You must hold the specialisations you claim, keep your working hours, time off and service areas current, and answer job offers within the offer window. Accepting an offer commits you to the job; declining is recorded with a reason but does not cost you your place in the rotation.",
  },
  {
    title: "How technicians are assigned",
    body: "Requests are assigned by a rotation queue per appliance type. Position advances when a technician accepts work, not by rating, experience or distance, and customers do not browse or hand-pick a technician. A technician may be passed over for a specific request when the time slot clashes with their existing bookings or exceeds their workload limit; that does not change their position in the queue.",
  },
  {
    title: "Estimates and bookings",
    body: "The technician who accepts your request sends a cost estimate. You accept or decline it; no work proceeds before you accept. Once accepted, you choose the appointment slot. Booking a slot re-checks the technician's schedule and workload, so a slot that conflicts is refused rather than silently double-booked.",
  },
  {
    title: "Cancellation and rescheduling",
    body: "You may cancel a request or booking before work starts. Cancelling or rescheduling after a technician has accepted does not return them to the front of the rotation — their turn was consumed when they accepted, and it stays consumed.",
  },
  {
    title: "Completion, inspection and payment",
    body: "When the technician marks the repair complete, you inspect the appliance and confirm it is working before payment unlocks. If the fault is still present, report it instead of confirming — that opens a support case rather than a payment. Payment is submitted by the customer only, as a reference number, and is verified by an administrator before it is marked confirmed.",
  },
  {
    title: "Disputes",
    body: "If a repair does not resolve the reported fault, use the inspection step to flag it or open a support ticket. Refund eligibility is assessed case by case. Going around the platform to settle a dispute privately removes your ability to escalate it here.",
  },
  {
    title: "Conduct",
    body: "Harassment, discriminatory behaviour, deliberately false requests, and attempts to manipulate the assignment queue are grounds for suspension. Suspended technicians keep their queue membership but are refused at eligibility time, so reinstating them does not restart their position.",
  },
  {
    title: "Availability of the service",
    body: "SPARKServ is provided as-is while it is under active development. Features may change, and repair work depends on technician availability in your area — a request that no eligible technician is free for will wait rather than be assigned.",
  },
  {
    title: "Status of this document",
    body: "These terms describe how the platform is actually built and operated. They are presented for review by the project owners and are not a substitute for legal advice; review them with counsel before relying on them as binding terms.",
  },
];

export const metadata = {
  title: "Terms of Service — SPARKServ",
  description: "The rules that apply to customers and technicians using SPARKServ.",
};

export default function TermsOfServicePage() {
  return (
    <PolicyLayout
      eyebrow="Legal"
      title="Terms of Service"
      intro="The rules both sides agree to when they use SPARKServ — what you commit to as a customer, what a technician commits to on accepting a job, and how assignment, estimates, inspection and payment work."
      updated="29 September 2026"
      sections={SECTIONS}
    />
  );
}
