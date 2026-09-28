"use client";

import Link from "next/link";
import Image from "next/image";
import {
  AirVent,
  ArrowRight,
  Bot,
  CookingPot,
  CreditCard,
  Fan,
  Headset,
  Microwave,
  Play,
  Refrigerator,
  Search,
  ShieldCheck,
  Tv,
  User,
  UsersRound,
  WashingMachine,
  Wrench,
  Zap,
} from "lucide-react";
import Footer from "@/components/Footer";

// The testimonials band was removed: the three quotes, names, and avatars were
// invented, and pairing fabricated praise with real customer accounts is a
// credibility risk. Restore it only with quotes collected from actual jobs.

// Deliberately five steps, not nine. The previous nine-step list was rendered
// nine-across on desktop (~100px per step) and nobody read it; the detail now
// lives on /how-it-works where there's room for it.
const howItWorksSteps = [
  { number: "1", icon: Search, title: "Describe the Problem", description: "Tell us what's wrong with your appliance." },
  { number: "2", icon: Bot, title: "Get Guided Help", description: "Smart troubleshooting or a repair request." },
  { number: "3", icon: User, title: "Get Matched Fairly", description: "Our queue assigns a qualified technician." },
  { number: "4", icon: Wrench, title: "Repair & Inspect", description: "Approve the estimate, then check the work." },
  { number: "5", icon: CreditCard, title: "Pay & Review", description: "Admin-verified payment, then share feedback." },
];


const supportedAppliances = [
  { name: "Refrigerator", href: "/services/refrigerator", icon: Refrigerator },
  { name: "Air Conditioner", href: "/services/air-conditioner", icon: AirVent },
  { name: "Washing Machine", href: "/services/washing-machine", icon: WashingMachine },
  { name: "Television", href: "/services/television", icon: Tv },
  { name: "Electric Fan", href: "/services/electric-fan", icon: Fan },
  { name: "Microwave & Oven", href: "/services/other-appliances", icon: Microwave },
  { name: "Rice Cooker", href: "/services/other-appliances", icon: CookingPot },
];

// Capabilities the platform actually enforces, not invented market numbers.
// This band previously rendered "12,540+ customers" and a "4.9/5" rating, then
// swung to showing the words "Fair Queue" and "Verified" as if they were
// statistics. A figure-shaped slot needs a figure; a capability gets prose.
const valueProps = [
  {
    icon: ShieldCheck,
    title: "Verified Technicians",
    body: "Technician accounts are reviewed and approved by an admin before they can accept a job.",
  },
  {
    icon: UsersRound,
    title: "Fair Rotation Queue",
    body: "New requests are matched by rotation, so work is spread across qualified technicians without favoritism.",
  },
  {
    icon: CreditCard,
    title: "Admin-Verified Payments",
    body: "Estimates and payments are confirmed by an admin, so the amount you approve is the amount you pay.",
  },
  {
    icon: Headset,
    title: "Support That Answers",
    body: "Reach the SPARKServ team by phone or email — before, during, and after the repair.",
  },
];

export default function HomePage() {
  return (
    <div>
      {/* Hero */}
      <section className="relative isolate overflow-hidden bg-navy-900">
        {/* The file on disk is spelled `Backgound.jpg` (no "r"). The previous
            markup pointed at `/images/Background.jpg`, which does not exist, so
            the hero photo was silently 404-ing.
            The crop anchor is not a preference either: in the 1788x592 source
            the subject cluster (technician + washing machine + lightning-bolt
            toolbox) sits in the lower-right, so it is biased right and down. With
            `object-center` the toolbox is visibly clipped from 1920px up. */}
        <Image
          src="/images/Backgound.jpg"
          alt="SPARKServ technician repairing a washing machine in a customer's home"
          fill
          priority
          quality={92}
          sizes="100vw"
          className="-z-20 object-cover object-[62%_62%]"
        />
        {/* Two scrims, both functional rather than decorative: the directional
            one holds the white headline column at 4.5:1, and the flat one keeps
            it readable on phones where the photo is cropped to portrait and the
            copy sits directly on the technician. */}
        <div aria-hidden="true" className="hero-copy-scrim absolute inset-0 -z-10" />
        <div aria-hidden="true" className="absolute inset-0 -z-10 bg-navy-900/55 lg:hidden" />

        <div className="spark-section relative flex min-h-[520px] flex-col justify-center py-14 md:min-h-[560px] md:py-16">
          <div className="max-w-2xl">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-white backdrop-blur-sm">
              <Zap className="h-3.5 w-3.5 text-brand-300" />
              Smart Appliance Repair
            </span>
            <h1 className="mt-5 text-4xl font-bold leading-[1.08] text-white sm:text-5xl lg:text-[3.5rem]">
              Your Home Appliances <br />
              <span className="text-brand-300">in Expert Hands</span>
            </h1>
            <p className="mt-6 max-w-xl text-base leading-7 text-white/80 md:text-lg">
              SPARKServ connects you with verified technicians for fast, reliable, and hassle-free appliance repair — anytime, anywhere in the Philippines.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href="/customer/request-repair"
                className="inline-flex h-12 cursor-pointer items-center justify-center gap-2 rounded-full bg-brand-500 px-7 text-sm font-semibold text-white shadow-soft transition-all duration-200 hover:bg-brand-600 active:scale-[0.98]"
              >
                Start Service Inquiry
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/how-it-works"
                className="inline-flex h-12 cursor-pointer items-center justify-center gap-2.5 rounded-full border border-white/45 px-7 text-sm font-semibold text-white transition-all duration-200 hover:border-white/70 hover:bg-white/10"
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full border border-white/60">
                  <Play className="h-2.5 w-2.5 fill-current" />
                </span>
                How SPARKServ Works
              </Link>
            </div>

            <div className="mt-10 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
              <TrustBadgeDetailed icon={<ShieldCheck className="h-4 w-4" />} label="Verified Technicians" sub="Background-checked & insured" />
              <TrustBadgeDetailed icon={<UsersRound className="h-4 w-4" />} label="Fair Queue System" sub="No favoritism. Equal opportunity." />
              <TrustBadgeDetailed icon={<CreditCard className="h-4 w-4" />} label="Secure Payments" sub="Admin-verified transactions." />
              <TrustBadgeDetailed icon={<Headset className="h-4 w-4" />} label="24/7 Support" sub="We're always ready to help." />
            </div>
          </div>
        </div>

        {/* Reassurance card from the mockup. It is a caption, not a control, so
            it must not intercept clicks meant for the hero copy on short
            viewports. */}
        <div className="pointer-events-none absolute right-6 top-8 hidden w-[19rem] items-center gap-3 rounded-2xl border border-white/70 bg-surface/95 px-5 py-4 shadow-[0_20px_45px_rgba(6,20,44,0.35)] backdrop-blur lg:flex">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-500 text-white">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <div>
            <p className="text-[13px] font-bold leading-tight text-ink">Trusted. Reliable. Professional.</p>
            <p className="mt-0.5 text-[11px] text-muted">Real people. Real service.</p>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="bg-soft py-16 md:py-24">
        <div className="spark-section">
          <div className="text-center max-w-3xl mx-auto mb-14">
            <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-brand-ink">How SPARKServ Works</span>
            <h2 className="mt-3 text-3xl font-bold text-ink sm:text-4xl">A Simpler Way to Get Your Appliance Fixed</h2>
            <p className="mt-4 text-base text-muted max-w-2xl mx-auto">From your first inquiry to the final payment, we make the repair process easy, transparent, and stress-free.</p>
          </div>

          <div className="relative">
            {/* Connector rail is positioning only, and hidden below lg where
                the steps wrap — a single line across wrapped rows would be
                meaningless. */}
            <div aria-hidden="true" className="absolute left-[8%] right-[8%] top-6 hidden h-px bg-line lg:block" />
            <div className="relative grid grid-cols-1 gap-x-6 gap-y-10 sm:grid-cols-3 lg:grid-cols-5">
              {howItWorksSteps.map((step) => (
                <div key={step.number} className="flex flex-col items-center text-center">
                  {/* One badge, not two — the number and the icon used to be
                      stacked as separate circles, which read as visual noise.
                      The ring matches the section canvas so the rail passes
                      behind the circle instead of through it. */}
                  <div className="relative mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-line bg-surface text-brand-ink ring-8 ring-line">
                    <step.icon className="h-5 w-5" />
                    <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-brand-600 text-[10px] font-bold text-white">
                      {step.number}
                    </span>
                  </div>
                  <h3 className="mb-1 text-sm font-semibold text-ink">{step.title}</h3>
                  <p className="text-xs leading-relaxed text-muted">{step.description}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Supported Appliances */}
      <section className="bg-surface py-16 md:py-24">
        <div className="spark-section">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-brand-ink">Supported Appliances</span>
            <h2 className="mt-3 text-3xl font-bold text-ink sm:text-4xl">Coverage for the appliances you rely on</h2>
            <p className="mt-4 text-base leading-7 text-muted">
              Choose the appliance that matches your problem, or describe it in your own words when you file a request.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {supportedAppliances.map((appliance) => (
              <Link
                key={appliance.name}
                href={appliance.href}
                className="group flex flex-col items-center gap-3 rounded-card border border-line bg-surface p-6 text-center transition-all duration-200 hover:border-brand-300 hover:bg-brand-soft/40"
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-soft text-brand-ink transition-colors duration-200 group-hover:bg-canvas">
                  <appliance.icon className="h-6 w-6" />
                </span>
                <span className="text-sm font-semibold text-ink">{appliance.name}</span>
              </Link>
            ))}
            {/* This was a <div> with cursor-pointer: it looked clickable, did
                nothing, and advertised "+7 more" against six real service pages. */}
            <Link
              href="/services"
              className="group flex flex-col items-center justify-center gap-3 rounded-card border border-dashed border-ink/20 bg-soft/60 p-6 text-center transition-all duration-200 hover:border-brand-400 hover:bg-brand-soft/40"
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-surface text-brand-ink ring-1 ring-inset ring-line transition-colors duration-200 group-hover:ring-brand-300">
                <ArrowRight className="h-5 w-5" />
              </span>
              <span className="text-sm font-semibold text-brand-ink">All services</span>
            </Link>
          </div>
        </div>
      </section>

      {/* Why SPARKServ */}
      <section className="border-y border-line bg-soft">
        <div className="spark-section py-16 md:py-24">
          <div className="mx-auto mb-12 max-w-2xl text-center">
            <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-brand-ink">Why SPARKServ</span>
            <h2 className="mt-3 text-3xl font-bold text-ink sm:text-4xl">Built around how repairs actually work</h2>
            <p className="mt-4 text-base leading-7 text-muted">
              Every rule in the platform exists to make a repair predictable — for the customer paying for it and for the technician doing it.
            </p>
          </div>

          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {valueProps.map((prop) => (
              <div key={prop.title} className="spark-card p-6">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-soft text-brand-ink">
                  <prop.icon className="h-5 w-5" />
                </span>
                <h3 className="mt-5 text-sm font-semibold text-ink">{prop.title}</h3>
                <p className="mt-2 text-xs leading-6 text-muted">{prop.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA. Uses the documented navy gradient so it reads as a distinct
          plate from the flat brand-900 footer sitting directly beneath it. */}
      <section className="spark-navy-gradient relative overflow-hidden text-white">
        <div className="spark-section py-16 md:py-24">
          <div className="mx-auto max-w-3xl text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-white">
              <Zap className="h-3.5 w-3.5" />
              Get Started
            </span>
            <h2 className="mt-5 text-3xl font-bold sm:text-4xl lg:text-5xl">Ready to get your appliance fixed?</h2>
            <p className="mt-5 text-base leading-7 text-white/80 md:text-lg">
              File a request in a few minutes. You approve the estimate before any work begins, and you can follow the repair from inquiry to completion.
            </p>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                href="/customer/request-repair"
                className="inline-flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-white px-8 text-sm font-semibold text-navy-900 transition-all duration-200 hover:bg-white/90 active:scale-[0.98] sm:w-auto"
              >
                Book a Service <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/register"
                className="inline-flex h-12 w-full cursor-pointer items-center justify-center rounded-full border border-white/45 px-8 text-sm font-semibold text-white transition-all duration-200 hover:border-white/70 hover:bg-white/10 sm:w-auto"
              >
                Create an Account
              </Link>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}

/* Sits on the hero photograph, so it is the inverted variant of the light
   `TrustBadgeDetailed` it used to be: translucent white chip, white glyph,
   white label — never brand-on-white, which disappeared against the scrim. */
function TrustBadgeDetailed({ icon, label, sub }: { icon: React.ReactNode; label: string; sub: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/15 text-white ring-1 ring-inset ring-white/25">
        {icon}
      </span>
      <div>
        <p className="text-xs font-semibold text-white">{label}</p>
        <p className="text-[11px] leading-snug text-white/65">{sub}</p>
      </div>
    </div>
  );
}

