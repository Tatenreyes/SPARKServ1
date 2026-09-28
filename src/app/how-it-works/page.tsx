"use client";

import Link from "next/link";
import Image from "next/image";
import { motion } from "motion/react";
import {
  ArrowRight,
  CalendarCheck2,
  CheckCircle2,
  MessageSquareText,
  Search,
  ShieldCheck,
  Star,
  UsersRound,
} from "lucide-react";
import Footer from "@/components/Footer";
import { staggerContainer, fadeUp, viewportOnce } from "@/lib/motion-variants";

const STEPS = [
  { number: "01", icon: Search, title: "Tell us what needs fixing", body: "Choose your appliance and describe the issue in a few simple steps." },
  { number: "02", icon: MessageSquareText, title: "Review your options", body: "Get practical guidance, transparent estimates, and technician recommendations." },
  { number: "03", icon: CalendarCheck2, title: "Book a convenient visit", body: "Choose a schedule that works for you and confirm the service details." },
  { number: "04", icon: CheckCircle2, title: "Track the repair", body: "Stay updated through completion, payment, and your service history." },
];

export default function HowItWorksPage() {
  return (
    <main className="bg-surface">
      <section className="relative overflow-hidden bg-brand-900 text-white">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_72%_35%,_rgba(37,101,218,0.2),transparent_32%)]" />
        <div className="spark-section relative px-4 py-16 md:py-24">
          <motion.div
            initial="hidden"
            whileInView="show"
            viewport={viewportOnce}
            variants={staggerContainer(0.1)}
            className="mx-auto max-w-3xl text-center"
          >
            <motion.span variants={fadeUp} className="text-[10px] font-bold uppercase tracking-[0.16em] text-spark-300">
              How SPARKServ works
            </motion.span>
            <motion.h1 variants={fadeUp} className="mt-4 max-w-2xl text-4xl font-semibold leading-tight md:text-6xl">
              A clearer way to get home service done.
            </motion.h1>
            <motion.p variants={fadeUp} className="mt-5 max-w-xl text-base leading-7 text-white/70">
              From your first request to the final update, every step is organized, visible, and built around your time.
            </motion.p>
          </motion.div>
        </div>
      </section>

      <section className="spark-section py-16 md:py-24">
        <motion.div
          initial="hidden"
          whileInView="show"
          viewport={viewportOnce}
          variants={staggerContainer(0.1)}
        >
          <div className="text-center max-w-2xl mx-auto mb-14">
            <motion.span variants={fadeUp} className="text-[10px] font-bold uppercase tracking-[0.16em] text-brand-ink">
              The Process
            </motion.span>
            <motion.h2 variants={fadeUp} className="mt-3 text-3xl font-bold text-ink sm:text-4xl">
              Four Simple Steps to Get Your Appliance Fixed
            </motion.h2>
          </div>
          <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-4">
            {STEPS.map(({ number, icon: Icon, title, body }) => (
              <motion.div
                key={number}
                variants={fadeUp}
                className="relative rounded-2xl border border-line bg-surface p-7 shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-soft text-brand-ink">
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="font-mono text-sm font-semibold text-brand-300">{number}</span>
                </div>
                <h2 className="mt-6 text-xl font-semibold text-ink">{title}</h2>
                <p className="mt-2 text-sm leading-6 text-muted">{body}</p>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </section>

      <section className="bg-soft border-y border-line">
        <div className="spark-section py-16 md:py-24">
          <motion.div
            initial="hidden"
            whileInView="show"
            viewport={viewportOnce}
            variants={staggerContainer(0.1)}
            className="grid items-center gap-12 md:grid-cols-2"
          >
            <div>
              <motion.span variants={fadeUp} className="text-[10px] font-bold uppercase tracking-[0.16em] text-brand-ink">
                Why SPARKServ
              </motion.span>
              <motion.h2 variants={fadeUp} className="mt-3 text-3xl font-bold text-ink sm:text-4xl">
                Built for real repair operations
              </motion.h2>
              <motion.p variants={fadeUp} className="mt-4 text-base text-muted">
                Clear requests, technician matching, and repair progress updates — all in one platform designed for customers and technicians.
              </motion.p>
              <motion.div variants={fadeUp} className="mt-8 space-y-4">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-ink">
                    <ShieldCheck className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-ink">Verified Technicians</p>
                    <p className="text-sm text-muted">Every technician is reviewed and approved before joining the platform.</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-ink">
                    <Star className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-ink">Transparent Ratings</p>
                    <p className="text-sm text-muted">See real customer feedback and technician performance history.</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-ink">
                    <UsersRound className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-ink">Real-Time Updates</p>
                    <p className="text-sm text-muted">Track your service status live from request to completion.</p>
                  </div>
                </div>
              </motion.div>
            </div>
            <motion.div variants={fadeUp} className="relative">
              <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl border border-line bg-soft shadow-card">
                <Image
                  src="/images/new landing page.jpg"
                  alt="SPARKServ technician repairing an appliance"
                  fill
                  priority
                  sizes="(max-width: 768px) 100vw, 50vw"
                  quality={95}
                  className="object-cover object-center"
                />
              </div>
              <div className="absolute -right-4 -bottom-4 hidden h-28 w-28 rounded-full bg-brand-soft/50 blur-2xl lg:block" />
              <div className="absolute -left-4 top-10 hidden h-24 w-24 rounded-full bg-spark-200/50 blur-2xl lg:block" />
            </motion.div>
          </motion.div>
        </div>
      </section>

      <section className="spark-section pb-16 md:pb-24">
        <div className="flex flex-col items-start justify-between gap-5 rounded-2xl bg-spark-500 p-7 text-white md:flex-row md:items-center">
          <div>
            <h2 className="text-2xl font-semibold">Ready to start?</h2>
            <p className="mt-1 text-sm text-white/80">Tell us what your appliance needs.</p>
          </div>
          {/* Fixed white on a fixed `spark-500` band — see the same note on the
              services page CTA. Theme tokens here would invert with the page and
              leave a dark button on a blue band. */}
          <Link
            href="/customer/request-repair"
            className="inline-flex items-center rounded-lg bg-white px-5 py-3 text-sm font-semibold text-navy-900 transition hover:bg-white/90"
          >
            Start a service inquiry <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </div>
      </section>

      <Footer />
    </main>
  );
}
