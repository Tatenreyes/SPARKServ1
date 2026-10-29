import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import SupportTicketsClient, { type SupportPreset } from "@/components/SupportTicketsClient";
import MobileSectionLinks from "@/components/mobile/MobileSectionLinks";
import { Headset, MessageSquareText, ShieldQuestion, Sparkles } from "lucide-react";

/**
 * Support, as the mobile Support tab lands on it.
 *
 * The tickets list is the substance of the page and is unchanged; what is added
 * is the small hub above it, because on a phone the Support tab has to answer
 * "where do I talk to a person?" — messages, a ticket, a warranty question, or
 * feedback about the app — before it answers "what have I already raised?".
 *
 * `?topic=warranty|feedback` opens the ticket form with the type and opening
 * line already chosen, so the two most specific entry points do not make the
 * customer re-classify their own message. Nothing about the ticketing API or its
 * rules changes; the preset only fills the form in.
 */
export default async function SupportTicketsPage({
  searchParams,
}: {
  searchParams?: { topic?: string };
}) {
  const user = await getCurrentUser();
  const supabase = createClient();

  const { data: tickets } = await supabase
    .from("support_tickets")
    .select("*")
    .eq("user_id", user!.id)
    .order("created_at", { ascending: false });

  const topic = searchParams?.topic;
  const preset: SupportPreset | undefined =
    topic === "warranty" || topic === "feedback" ? topic : undefined;

  return (
    <div className="space-y-5">
      <div>
        <p className="spark-eyebrow">Support</p>
        <h1 className="mt-1.5 font-display text-2xl font-bold tracking-tight text-ink">
          Support
        </h1>
        <p className="mt-1.5 text-sm leading-relaxed text-muted">
          For account or platform issues — not appliance repairs. For a repair, use{" "}
          <span className="font-medium text-ink">Request a repair</span> instead.
        </p>
      </div>

      <MobileSectionLinks
        links={[
          {
            href: "/customer/messages",
            label: "Messages",
            hint: "Chat with your assigned technician",
            icon: MessageSquareText,
          },
          {
            href: "/customer/support",
            label: "Support tickets",
            hint: "Account and platform problems",
            icon: Headset,
          },
          {
            href: "/customer/support?topic=warranty",
            label: "Warranty concerns",
            hint: "Coverage questions after a repair",
            icon: ShieldQuestion,
          },
          {
            href: "/customer/support?topic=feedback",
            label: "Feedback",
            hint: "Tell us what worked and what didn't",
            icon: Sparkles,
          },
        ]}
      />

      <section className="rounded-card border border-line bg-surface px-4 pb-5 pt-4 shadow-[0_1px_2px_rgba(16,38,74,0.04)] sm:px-5">
        <h2 className="font-display text-[15px] font-semibold text-ink">
          Your tickets
        </h2>
        <p className="mt-0.5 text-xs leading-relaxed text-muted">
          Every ticket you have opened, with its current status.
        </p>
        <SupportTicketsClient initialTickets={tickets ?? []} preset={preset} />
      </section>
    </div>
  );
}

