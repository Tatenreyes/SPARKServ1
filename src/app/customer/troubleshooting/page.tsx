import Link from "next/link";
import Chatbot from "@/components/Chatbot";

export default function TroubleshootingPage() {
  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-ink">Troubleshooting guide</h1>
      <p className="mt-1 text-sm text-ink/65">
        Describe the problem and get a few quick checks before booking a technician.
      </p>

      <div className="mt-6 max-w-xl">
        <Chatbot />
      </div>

      <p className="mt-4 text-sm text-ink/50">
        Still stuck?{" "}
        <Link href="/customer/inquiry" className="font-medium text-brand-600 hover:underline">
          Submit a service request
        </Link>{" "}
        and we&apos;ll match you with a technician.
      </p>
    </div>
  );
}
