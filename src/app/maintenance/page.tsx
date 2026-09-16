import { Wrench } from "lucide-react";

export default function MaintenancePage() {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-6 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-50 text-brand-600">
        <Wrench className="h-6 w-6" />
      </span>
      <h1 className="mt-4 font-display text-xl font-semibold text-ink">
        SPARKServ is temporarily down for maintenance
      </h1>
      <p className="mt-2 max-w-sm text-sm text-ink/60">
        We&apos;re making some improvements. Please check back shortly.
      </p>
    </div>
  );
}
