import MobileSectionLinks from "@/components/mobile/MobileSectionLinks";
import SignOutRow from "@/components/mobile/SignOutRow";
import { Boxes, Bell, FileText, UserRound } from "lucide-react";

/**
 * The mobile "Me" tab hub.
 *
 * The Account section on a phone: the customer's appliances, their profile, the
 * notification list that the bell in the topbar summarises, the policies they
 * agreed to, and the way out. Logout lives here rather than only behind the
 * avatar menu because that menu is a two-tap detour on a phone, and because
 * "where do I sign out" is a question people ask of the Account tab.
 */
export default function CustomerAccountPage() {
  return (
    <div className="space-y-5">
      <div>
        <p className="spark-eyebrow">Account</p>
        <h1 className="mt-1.5 font-display text-2xl font-bold tracking-tight text-ink">
          My account
        </h1>
        <p className="mt-1.5 text-sm leading-relaxed text-muted">
          Your appliances, details and everything we&apos;ve told you.
        </p>
      </div>

      <MobileSectionLinks
        title="Your details"
        links={[
          {
            href: "/customer/appliances",
            label: "My appliances",
            hint: "Models, serials and warranty status",
            icon: Boxes,
          },
          {
            href: "/customer/profile",
            label: "Profile",
            hint: "Name, contact number and photo",
            icon: UserRound,
          },
        ]}
      />

      <MobileSectionLinks
        title="Updates and policies"
        links={[
          {
            href: "/customer/account/notifications",
            label: "Notifications",
            hint: "Everything we've sent you, newest first",
            icon: Bell,
          },
          {
            href: "/policies/customer",
            label: "Policies",
            hint: "Service terms, coverage and privacy",
            icon: FileText,
          },
        ]}
      />

      <section className="overflow-hidden rounded-card border border-line bg-surface shadow-[0_1px_2px_rgba(16,38,74,0.04)]">
        <SignOutRow />
      </section>
    </div>
  );
}
