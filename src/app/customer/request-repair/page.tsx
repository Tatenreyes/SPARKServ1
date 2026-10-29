import Link from "next/link";
import RequestRepairWizard from "@/components/RequestRepairWizard";
import { ChevronRight } from "lucide-react";

export default function RequestRepairPage() {
  return (
    <div className="space-y-3">
      <nav className="flex flex-wrap items-center gap-1 text-xs text-muted">
        <Link href="/customer/dashboard" className="hover:text-ink transition-colors">
          Dashboard
        </Link>
        <ChevronRight className="h-3 w-3 shrink-0 opacity-50" aria-hidden="true" />
        <Link href="/customer/request-repair" className="hover:text-ink transition-colors">
          Service Inquiry
        </Link>
        <ChevronRight className="h-3 w-3 shrink-0 opacity-50" aria-hidden="true" />
        <span className="text-ink/70 font-medium">Request a Repair</span>
      </nav>
      <h1 className="mt-1 font-display text-2xl font-semibold text-ink">Request a Repair</h1>
      <p className="mt-1 text-sm text-ink/65">
        Tell us about your appliance and the issue. We&apos;ll help you get it fixed.
      </p>
      <div className="mt-6">
        <RequestRepairWizard />
      </div>
    </div>
  );
}
