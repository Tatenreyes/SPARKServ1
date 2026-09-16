const SECTIONS = [
  {
    title: "Eligibility",
    body: "Technician accounts require admin approval before entering the assignment queue. Approval considers stated specializations and experience.",
  },
  {
    title: "Account Verification",
    body: "Admins may request additional verification before approving a technician account. Approval status can be revoked if account information is found to be inaccurate.",
  },
  {
    title: "Availability Requirements",
    body: "Keep your availability status current — the queue only offers requests to technicians marked available, matching your specialization.",
  },
  {
    title: "Job Assignment / Queue Fairness Policy",
    body: "SPARKServ assigns requests through a fair rotation queue, separate for each appliance type. Every qualified technician takes a turn based on when they last accepted a job of that type — a technician with many reviews does not receive more turns than a technician with none. You cannot browse or select requests yourself — only respond to what's offered.",
  },
  {
    title: "Estimate Requirements",
    body: "Once you accept an assignment, submit a clear cost estimate (labor, parts, and any notes) promptly so the customer can decide whether to proceed.",
  },
  {
    title: "Repair Documentation Requirements",
    body: "Log each visit with notes and, where relevant, photos. This builds a clear repair record for the customer and for SPARKServ's records.",
  },
  {
    title: "Customer Communication",
    body: "Use in-app messaging to coordinate scheduling and answer customer questions. Keep communication professional and timely.",
  },
  {
    title: "Rejection Rules",
    body: "You may reject an offered assignment if you have a valid reason. Rejecting immediately returns the request to the queue for the next eligible technician — you will not be re-offered the same request, though your position in the rotation for other requests is unaffected.",
  },
  {
    title: "Completion Requirements",
    body: "Mark a repair complete only once the work is actually done. This triggers a customer inspection step before payment — repairs that don't hold up to inspection may result in a follow-up support case.",
  },
  {
    title: "Professional Conduct",
    body: "Treat customers and their property with respect. Misconduct reported through support tickets may result in account review or deactivation.",
  },
  {
    title: "Dispute Handling",
    body: "If a customer reports a problem after inspection, SPARKServ will review the case and may ask you to follow up on the original repair.",
  },
];

export default function TechnicianPoliciesPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="font-display text-2xl font-semibold text-ink">SPARKServ Technician Policies</h1>
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
