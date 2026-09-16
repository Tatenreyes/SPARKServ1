import RequestRepairWizard from "@/components/RequestRepairWizard";

export default function RequestRepairPage() {
  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-ink">Continue your service journey</h1>
      <p className="mt-1 text-sm text-ink/65">Start with the problem so SPARKServ can guide you to the right technician and booking.</p>
      <div className="mt-6">
        <RequestRepairWizard />
      </div>
    </div>
  );
}
