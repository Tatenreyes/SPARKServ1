import PolicyLayout, { type PolicySection } from "@/components/PolicyLayout";

const SECTIONS: PolicySection[] = [
  {
    title: "What we collect",
    body: "When you create an account we store your name, email address, role, and — if you add one — a profile photo. When you use the service we store the appliances you register, the repair requests you file, the messages you exchange with an assigned technician, the estimates and bookings attached to a job, and the payment reference you submit after a repair is confirmed.",
  },
  {
    title: "Why we collect it",
    body: "Your request details are what the assignment engine evaluates to decide whether a technician is a genuine fit for the job. Your messages carry the conversation that replaces an off-platform phone call. Your payment reference exists so an administrator can verify that the amount confirmed matches the amount paid.",
  },
  {
    title: "Who can see it",
    body: "Access is limited by role, and those limits are enforced in the database rather than in the interface. A customer can read only their own requests, bookings and messages. A technician sees the jobs assigned to them and the contact details needed to attend — not other customers' records, and not other technicians' account details. Administrators and super administrators can read platform-wide data in order to run the service.",
  },
  {
    title: "Who cannot see it",
    body: "Customers never see the technician rotation, other customers' records, or technician documents. Technicians never see the queue data of appliances they are not qualified for, other technicians' documents, or administrative reports. The service-role key used by the server is never exposed to the browser.",
  },
  {
    title: "Payments",
    body: "SPARKServ does not process card payments and does not store card numbers. Payment is recorded as a reference number submitted by the customer and verified by an administrator. Only the customer can submit a payment record for their own job.",
  },
  {
    title: "Notifications",
    body: "If you enable browser notifications, we store the push subscription your browser generates so a job offer, a status change, or a new message can reach you. You can turn this off at any time from your browser's site settings, which invalidates the stored subscription.",
  },
  {
    title: "Data sharing",
    body: "Your data is not sold. It is shared only between the roles that need it to complete a repair: the customer who filed the request, the technician assigned to it, and the administrators who oversee the platform. Infrastructure is provided by Supabase (database and authentication) and Vercel (hosting).",
  },
  {
    title: "Retention and your choices",
    body: "Repair records are retained so service history and completed work remain auditable. You can update your name, address and profile photo at any time from your profile page, and you can ask an administrator to remove your account. Some records — a confirmed payment, a completed job — are kept after account removal because they document a transaction that already happened.",
  },
  {
    title: "Status of this document",
    body: "This page describes how the platform is actually built and operated. It is presented for review by the project owners and is not a substitute for legal advice; review it with counsel before relying on it as binding terms.",
  },
];

export const metadata = {
  title: "Privacy Policy — SPARKServ",
  description: "How SPARKServ collects, uses and limits access to your data.",
};

export default function PrivacyPolicyPage() {
  return (
    <PolicyLayout
      eyebrow="Legal"
      title="Privacy Policy"
      intro="What SPARKServ stores about you, why it needs it, and who is allowed to read it. The short version: what a repair cannot be completed without, access limited by role, and nothing sold."
      updated="29 September 2026"
      sections={SECTIONS}
    />
  );
}
