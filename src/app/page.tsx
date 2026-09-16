"use client";

import Link from "next/link";
import Image from "next/image";
import {
  ArrowRight,
  CalendarDays,
  CreditCard,
  Headphones,
  ShieldCheck,
  Star,
  UserRoundCog,
  UsersRound,
  Quote,
  Wrench,
  Bot,
  User,
  FileText,
  Calendar,
  Shield,
  Search,
} from "lucide-react";

const testimonials = [
  {
    quote: "SPARKServ made finding a reliable technician so easy. My fridge was fixed the same day!",
    name: "Maria Santos",
    role: "Customer",
    avatar: "/images/about-image-1.jpg",
  },
  {
    quote: "The platform is intuitive and the technician matching is spot on. Highly recommended.",
    name: "Juan Dela Cruz",
    role: "Technician",
    avatar: "/images/C1-Featured-Image-Tech-working-on-a-fridge_-1.jpg",
  },
  {
    quote: "Transparent estimates and real-time updates gave me peace of mind throughout the repair.",
    name: "Ana Reyes",
    role: "Customer",
    avatar: "/images/cheerful-workman-white-wall_23-2147772246.avif",
  },
];

const howItWorksSteps = [
  { number: "1", icon: Search, title: "Describe the Problem", description: "Tell us what's wrong with your appliance." },
  { number: "2", icon: Bot, title: "Get Guided Help", description: "Smart troubleshooting or repair request." },
  { number: "3", icon: User, title: "Fair Queue Assignment", description: "Our system assigns technicians fairly." },
  { number: "4", icon: FileText, title: "Get an Estimate", description: "Review and approve the cost." },
  { number: "5", icon: Calendar, title: "Schedule Repair", description: "Choose a time that works for you." },
  { number: "6", icon: Wrench, title: "Repair", description: "Our technician gets it done." },
  { number: "7", icon: Shield, title: "Inspect", description: "Make sure it's working properly." },
  { number: "8", icon: CreditCard, title: "Pay", description: "Secure and verified payment." },
  { number: "9", icon: Star, title: "Review", description: "Share your feedback." },
];

const supportedAppliances = [
  { name: "Refrigerator", image: "/images/refrigerator.png" },
  { name: "Air Conditioner", image: "/images/aircon.jpg" },
  { name: "Washing Machine", image: "/images/washing machine.jpg" },
  { name: "Television", image: "/images/tv.jpg" },
  { name: "Electric Fan", image: "/images/Air fyers.PNG" },
  { name: "Microwave Oven", image: "/images/Microwave-Oven-Repairing.jpg" },
  { name: "Rice Cooker", image: "/images/Rice cooker.PNG" },
];

export default function HomePage() {
  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden bg-white">
        <div className="spark-section relative pt-6 pb-20 md:pt-8 md:pb-28 lg:py-12">
          <div className="grid items-center gap-12 md:grid-cols-2 lg:gap-16">
            <div>
              <div className="mb-5 inline-flex items-center gap-2 rounded-full bg-brand-50 px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-brand-700">
                <Wrench className="h-3.5 w-3.5" />
                Smart Appliance Repair
              </div>
              <h1 className="max-w-2xl text-4xl font-bold leading-[1.08] text-ink sm:text-5xl lg:text-[3.5rem]">
                Your Home Appliances <br />
                <span className="text-brand-600">in Expert Hands</span>
              </h1>
              <p className="mt-6 max-w-lg text-base leading-7 text-slate-600 md:text-lg">
                SPARKServ connects you with verified technicians for fast, reliable, and hassle-free appliance repair — anytime, anywhere in the Philippines.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link
                  href="/customer/inquiry"
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-brand-600 px-7 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 hover:shadow-md"
                >
                  <Search className="h-4 w-4" />
                  Start Service Inquiry <ArrowRight className="ml-1 h-4 w-4" />
                </Link>
                <Link
                  href="/how-it-works"
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-full border border-slate-300 bg-white px-7 text-sm font-semibold text-slate-700 transition hover:border-brand-400 hover:text-brand-700"
                >
                  <span className="flex h-5 w-5 items-center justify-center rounded-full border border-slate-400">
                    <svg viewBox="0 0 24 24" fill="currentColor" className="h-3 w-3 text-slate-600"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                  </span>
                  How SPARKServ Works
                </Link>
              </div>

              <div className="mt-10 grid grid-cols-2 gap-6 sm:grid-cols-4">
                <TrustBadgeDetailed icon={<ShieldCheck className="h-5 w-5" />} label="Verified Technicians" sub="Background checked & trained" />
                <TrustBadgeDetailed icon={<User className="h-5 w-5" />} label="Fair Queue System" sub="No favoritism. Equal opportunity." />
                <TrustBadgeDetailed icon={<ShieldCheck className="h-5 w-5" />} label="Secure Payments" sub="Verified by admin" />
                <TrustBadgeDetailed icon={<Headphones className="h-5 w-5" />} label="24/7 Support" sub="We're always here to help" />
              </div>
            </div>

            <div className="relative hidden md:block">
              <div className="relative h-[500px] w-full">
                <Image
                  src="/images/Background.jpg"
                  alt="SPARKServ technician repairing a washing machine"
                  fill
                  priority
                  sizes="(max-width: 768px) 100vw, 50vw"
                  quality={95}
                  className="object-cover object-center"
                />
              </div>
              <div className="absolute -right-4 top-4 flex items-center gap-2 rounded-xl border border-white/80 bg-white/95 px-3 py-2 shadow-lg">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 text-white">
                  <ShieldCheck className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-brand-700">Trusted. Reliable. Professional.</p>
                  <p className="text-[9px] text-slate-500">Real people. Real service.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="bg-slate-50 py-16 md:py-24">
        <div className="spark-section">
          <div className="text-center max-w-3xl mx-auto mb-14">
            <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-brand-600">How SPARKServ Works</span>
            <h2 className="mt-3 text-3xl font-bold text-ink sm:text-4xl">A Simpler Way to Get Your Appliance Fixed</h2>
            <p className="mt-4 text-base text-slate-600 max-w-2xl mx-auto">From your first inquiry to the final payment, we make the repair process easy, transparent, and stress-free.</p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-9 gap-4 lg:gap-2">
            {howItWorksSteps.map((step) => (
              <div key={step.number} className="flex flex-col items-center text-center">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-50 text-brand-600 mb-3">
                  <span className="text-xs font-bold">{step.number}</span>
                </div>
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white border border-slate-200 text-brand-600 mb-3">
                  <step.icon className="h-5 w-5" />
                </div>
                <h3 className="text-sm font-semibold text-slate-900 mb-1">{step.title}</h3>
                <p className="text-xs text-slate-500 leading-relaxed">{step.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Supported Appliances */}
      <section className="bg-white py-16 md:py-24">
        <div className="spark-section">
          <div className="text-center max-w-3xl mx-auto mb-14">
            <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-brand-600">Supported Appliances</span>
            <h2 className="mt-3 text-3xl font-bold text-ink sm:text-4xl">We Service 15+ Appliance Categories</h2>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-4">
            {supportedAppliances.map((appliance) => (
              <div key={appliance.name} className="flex flex-col items-center gap-3 rounded-2xl border border-slate-200 bg-white p-5 transition hover:border-brand-200 hover:shadow-md">
                <div className="relative h-12 w-12 overflow-hidden rounded-full bg-slate-50">
                  <Image
                    src={appliance.image}
                    alt={appliance.name}
                    width={48}
                    height={48}
                    className="h-full w-full object-cover"
                  />
                </div>
                <span className="text-xs font-medium text-slate-700 text-center">{appliance.name}</span>
              </div>
            ))}
            <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-slate-50/50 p-5 cursor-pointer hover:border-brand-300 hover:bg-brand-50/30 transition">
              <span className="text-xs font-medium text-slate-500">+7 more</span>
              <ArrowRight className="h-4 w-4 text-slate-400" />
            </div>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="relative border-y border-slate-200 bg-slate-50/80">
        <div className="spark-section grid grid-cols-2 gap-6 py-10 sm:gap-8 sm:py-12 lg:grid-cols-4">
          <ProofStat icon={<UsersRound className="h-6 w-6" />} value="12,540+" label="Happy Customers" />
          <ProofStat icon={<UserRoundCog className="h-6 w-6" />} value="2,350+" label="Verified Technicians" />
          <ProofStat icon={<CalendarDays className="h-6 w-6" />} value="24,680+" label="Services Completed" />
          <ProofStat icon={<Star className="h-6 w-6" />} value="4.9 / 5" label="Average Rating" />
        </div>
      </section>

      {/* Testimonials */}
      <section className="relative overflow-hidden bg-white">
        <div className="spark-section py-16 md:py-24">
          <div className="text-center max-w-2xl mx-auto mb-14">
            <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-brand-600">Testimonials</span>
            <h2 className="mt-3 text-3xl font-bold text-ink sm:text-4xl">Trusted by Thousands of Customers</h2>
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            {testimonials.map((testimonial) => (
              <div key={testimonial.name} className="flex flex-col rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
                <Quote className="h-8 w-8 text-brand-200 mb-4" />
                <p className="text-sm leading-7 text-slate-700 flex-1">&ldquo;{testimonial.quote}&rdquo;</p>
                <div className="mt-6 flex items-center gap-3">
                  <div className="relative h-10 w-10 overflow-hidden rounded-full bg-slate-100">
                    <Image
                      src={testimonial.avatar}
                      alt={testimonial.name}
                      fill
                      className="object-cover"
                      sizes="40px"
                    />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-ink">{testimonial.name}</p>
                    <p className="text-xs text-slate-500">{testimonial.role}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative overflow-hidden bg-brand-900 text-white">
        <div className="absolute inset-0 bg-[linear-gradient(90deg,transparent,rgba(37,101,218,0.4)),repeating-linear-gradient(135deg,rgba(255,255,255,0.04)_0,rgba(255,255,255,0.04)_2px,transparent_2px,transparent_10px)]" />
        <div className="spark-section relative py-16 md:py-24">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="text-3xl font-bold sm:text-4xl lg:text-5xl">Ready to Get Your Appliance Fixed?</h2>
            <p className="mt-5 text-lg text-white/70">Join thousands of satisfied customers and experience hassle-free appliance repair today.</p>
            <div className="mt-9 flex flex-wrap justify-center gap-4">
              <Link
                href="/customer/inquiry"
                className="inline-flex h-12 items-center justify-center rounded-xl bg-white px-8 text-sm font-semibold text-brand-700 shadow-sm transition hover:bg-brand-50"
              >
                Book a Service <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
              <Link
                href="/register"
                className="inline-flex h-12 items-center justify-center rounded-xl border border-white/40 px-8 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                Get Started
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function ProofStat({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <div className="flex flex-col items-center text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-brand-600 shadow-sm mb-3">
        {icon}
      </span>
      <p className="font-display text-xl font-bold text-ink">{value}</p>
      <p className="text-xs text-slate-500 mt-1">{label}</p>
    </div>
  );
}

function TrustBadgeDetailed({ icon, label, sub }: { icon: React.ReactNode; label: string; sub: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600">
        {icon}
      </span>
      <div>
        <p className="text-xs font-semibold text-slate-900">{label}</p>
        <p className="text-[11px] text-slate-500">{sub}</p>
      </div>
    </div>
  );
}

