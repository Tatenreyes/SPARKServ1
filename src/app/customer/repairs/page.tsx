import MobileSectionLinks from "@/components/mobile/MobileSectionLinks";
import {
  CalendarClock,
  ClipboardList,
  CircleDollarSign,
  History,
  Plus,
  Timer,
  Wrench,
} from "lucide-react";

/**
 * The mobile "Repairs" tab hub.
 *
 * A phone tab bar holds four destinations, so each tab needs one level of depth
 * behind it. This is that level for repairs: every repair destination the app
 * has, described in one line, in the order a customer actually meets them
 * (start → watch → pay → look back). All of them point at the existing pages —
 * this is a directory, not a second implementation, so there is one source of
 * truth per screen.
 */
export default function RepairsHubPage() {
  return (
    <div className="space-y-5">
      <div>
        <p className="spark-eyebrow">Service requests</p>
        <h1 className="mt-1.5 font-display text-2xl font-bold tracking-tight text-ink">
          Repairs
        </h1>
        <p className="mt-1.5 text-sm leading-relaxed text-muted">
          Everything from starting a request to reading the finished service report.
        </p>
      </div>

      <MobileSectionLinks
        title="Start here"
        links={[
          {
            href: "/customer/request-repair",
            label: "Start service inquiry",
            hint: "Describe the fault and we'll find a technician",
            icon: Plus,
          },
          {
            href: "/customer/repairs/requests",
            label: "Repair requests",
            hint: "Every request you've submitted",
            icon: ClipboardList,
          },
        ]}
      />

      <MobileSectionLinks
        title="While it's in progress"
        links={[
          {
            href: "/customer/estimates",
            label: "Estimates",
            hint: "Review and approve repair costs",
            icon: Wrench,
          },
          {
            href: "/customer/bookings",
            label: "Bookings",
            hint: "Confirm visit dates and times",
            icon: CalendarClock,
          },
          {
            href: "/customer/progress-tracking",
            label: "Repair progress",
            hint: "Follow visits and inspection",
            icon: Timer,
          },
          {
            href: "/customer/bookings",
            label: "Payments",
            hint: "Settle a balance and upload proof",
            icon: CircleDollarSign,
          },
        ]}
      />

      <MobileSectionLinks
        title="Afterwards"
        links={[
          {
            href: "/customer/repair-history",
            label: "Service history",
            hint: "Completed repairs and reports",
            icon: History,
          },
        ]}
      />
    </div>
  );
}
