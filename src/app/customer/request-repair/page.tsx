import RequestRepairWizard from "@/components/RequestRepairWizard";

export default function RequestRepairPage() {
  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-ink">Request a Repair</h1>
      <p className="mt-1 text-sm text-ink/65">Select your appliance, describe the problem, and we will match you with a qualified technician.</p>
      <div className="mt-6">
        <RequestRepairWizard />
      </div>
    </div>
  );
}
