import Link from "next/link";
import { ChevronRight, ClipboardList, FileText, LifeBuoy, Plus, type LucideIcon } from "lucide-react";

/**
 * Shortcuts out of the dashboard. Each tile carries a colour-coded icon tile and
 * a one-line hint, so the grid scans as four destinations rather than four
 * identical grey buttons.
 */
const ACTIONS: {
  label: string;
  hint: string;
  href: string;
  icon: LucideIcon;
  tone: string;
}[] = [
  {
    label: "Add appliance",
    hint: "Register a unit",
    href: "/customer/appliances",
    icon: Plus,
    tone: "bg-brand-soft text-brand-ink",
  },
  {
    label: "Service history",
    hint: "Past repairs",
    href: "/customer/repair-history",
    icon: ClipboardList,
    tone: "bg-signal-soft text-signal-ink",
  },
  {
    label: "Contact support",
    hint: "Requests and bookings",
    href: "/customer/support",
    icon: LifeBuoy,
    tone: "bg-warn-soft text-warn-ink",
  },
  {
    label: "View policies",
    hint: "Terms & coverage",
    href: "/policies/customer",
    icon: FileText,
    tone: "bg-soft text-muted",
  },
];

export function QuickActions() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {ACTIONS.map((action) => (
        <Link
          key={action.label}
          href={action.href}
          className="group flex cursor-pointer items-center gap-2 rounded-xl border border-line bg-surface p-2 transition duration-200 hover:border-brand-300 hover:bg-brand-soft/40"
        >
          <span
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${action.tone}`}
          >
            <action.icon className="h-3.5 w-3.5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-semibold text-ink">{action.label}</span>
            <span className="mt-0.5 block truncate text-[11px] text-muted">
              {action.hint}
            </span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted/60 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-brand-ink" />
        </Link>
      ))}
    </div>
  );
}

