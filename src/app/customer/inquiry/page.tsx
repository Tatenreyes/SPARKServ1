import InquiryWizard from "@/components/InquiryWizard";

export default function ServiceInquiryPage() {
  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-ink">Describe your appliance problem</h1>
      <p className="mt-1 text-sm text-ink/65">
        SPARKServ will guide you from issue classification and basic troubleshooting to a
        technician, estimate, booking, and repair tracking.
      </p>
      <div className="mt-6">
        <InquiryWizard />
      </div>
    </div>
  );
}
