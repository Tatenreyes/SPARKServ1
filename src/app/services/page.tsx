"use client";

import Link from "next/link";
import Image from "next/image";
import { motion } from "motion/react";
import {
  ArrowRight,
  CalendarCheck2,
  CheckCircle2,
  Clock3,
  Headphones,
  MessageSquareText,
  Search,
  ShieldCheck,
} from "lucide-react";
import Footer from "@/components/Footer";
import { SERVICE_DETAILS } from "@/lib/service-details";
import { staggerContainer, fadeUp, cardFadeUp, viewportOnce } from "@/lib/motion-variants";

const ICONS = [ShieldCheck, Clock3, CheckCircle2, Headphones];

const services = [
  {
    title: "Refrigerators",
    description: "Expert repair for all refrigerator brands and types.",
    image: "/images/refrigerator.png",
  },
  {
    title: "Air Conditioners",
    description: "Installation, maintenance, and repair services.",
    image: "/images/aircon.jpg",
  },
  {
    title: "Washing Machines",
    description: "Reliable fixes for top-load and front-load washers.",
    image: "/images/washing machine.jpg",
  },
  {
    title: "Microwave Ovens",
    description: "Quick diagnostics and repairs for microwave units.",
    image: "/images/Microwave-Oven-Repairing.jpg",
  },
];

const steps = [
  {
    number: "01",
    icon: Search,
    title: "Book a Service",
    description: "Describe your appliance issue and schedule a visit online in minutes.",
  },
  {
    number: "02",
    icon: MessageSquareText,
    title: "Get Matched",
    description: "We match you with the best verified technician near your location.",
  },
  {
    number: "03",
    icon: CalendarCheck2,
    title: "Fix & Track",
    description: "Track progress in real time and pay only when the repair is complete.",
  },
];

export default function ServicesPage() {
  return (
    <main className="bg-white">
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
              Our Services
            </motion.span>
            <motion.h1 variants={fadeUp} className="mt-4 max-w-2xl text-4xl font-semibold leading-tight md:text-6xl">
              We Repair a Wide Range of Appliances
            </motion.h1>
            <motion.p variants={fadeUp} className="mt-5 max-w-xl text-base leading-7 text-white/70">
              Professional diagnostics and repairs for all major home and commercial appliances.
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
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {services.map((service) => (
              <motion.div
                key={service.title}
                variants={cardFadeUp}
                whileHover={{ y: -6, transition: { duration: 0.2 } }}
                className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:shadow-lg"
              >
                <div className="aspect-[4/3] w-full overflow-hidden bg-slate-100">
                  <Image
                    src={service.image}
                    alt={service.title}
                    width={400}
                    height={300}
                    className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                  />
                </div>
                <div className="p-5">
                  <h3 className="font-display text-base font-bold text-ink">{service.title}</h3>
                  <p className="mt-1.5 text-sm leading-6 text-slate-600">{service.description}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </section>

      <section className="bg-slate-50 border-y border-slate-200">
        <div className="spark-section py-16 md:py-24">
          <motion.div
            initial="hidden"
            whileInView="show"
            viewport={viewportOnce}
            variants={staggerContainer(0.1)}
          >
            <div className="text-center max-w-2xl mx-auto mb-14">
              <motion.span variants={fadeUp} className="text-[10px] font-bold uppercase tracking-[0.16em] text-brand-600">
                How It Works
              </motion.span>
              <motion.h2 variants={fadeUp} className="mt-3 text-3xl font-bold text-ink sm:text-4xl">
                Three Simple Steps to Get Your Appliance Fixed
              </motion.h2>
            </div>
            <div className="grid gap-8 md:grid-cols-3">
              {steps.map((step) => (
                <motion.div
                  key={step.number}
                  variants={fadeUp}
                  className="relative rounded-2xl border border-slate-200 bg-white p-7 shadow-sm"
                >
                  <div className="flex items-center gap-4 mb-4">
                    <span className="font-display text-3xl font-bold text-brand-200">{step.number}</span>
                    <div className="h-px flex-1 bg-slate-200" />
                  </div>
                  <h3 className="font-display text-lg font-bold text-ink">{step.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{step.description}</p>
                </motion.div>
              ))}
            </div>
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
            <motion.span variants={fadeUp} className="text-[10px] font-bold uppercase tracking-[0.16em] text-brand-600">
              All Services
            </motion.span>
            <motion.h2 variants={fadeUp} className="mt-3 text-3xl font-bold text-ink sm:text-4xl">
              Browse All Appliance Services
            </motion.h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {SERVICE_DETAILS.map((service, index) => {
              const Icon = ICONS[index % ICONS.length];
              return (
                <motion.div key={service.slug} variants={cardFadeUp}>
                  <Link
                    href={`/services/${service.slug}`}
                    className="group flex flex-col rounded-2xl border border-slate-200 bg-white p-6 transition hover:-translate-y-1 hover:border-brand-500 hover:shadow-lg"
                  >
                    <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                      <Icon className="h-5 w-5" />
                    </span>
                    <h2 className="mt-5 text-xl font-semibold text-slate-950">{service.name}</h2>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{service.description}</p>
                    <span className="mt-5 inline-flex items-center text-sm font-semibold text-brand-600">
                      View service <ArrowRight className="ml-2 h-4 w-4 transition group-hover:translate-x-1" />
                    </span>
                  </Link>
                </motion.div>
              );
            })}
          </div>
        </motion.div>
      </section>

      <section className="relative overflow-hidden bg-brand-900 text-white">
        <div className="absolute inset-0 bg-[linear-gradient(90deg,transparent,rgba(37,101,218,0.4)),repeating-linear-gradient(135deg,rgba(255,255,255,0.04)_0,rgba(255,255,255,0.04)_2px,transparent_2px,transparent_10px)]" />
        <div className="spark-section relative py-16 md:py-24">
          <div className="mx-auto max-w-3xl text-center">
            <motion.h2
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={viewportOnce}
              transition={{ duration: 0.6 }}
              className="text-3xl font-bold sm:text-4xl lg:text-5xl"
            >
              Ready to Get Your Appliance Fixed?
            </motion.h2>
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={viewportOnce}
              transition={{ duration: 0.6, delay: 0.1 }}
              className="mt-5 text-lg text-white/70"
            >
              Join thousands of satisfied customers and experience hassle-free appliance repair today.
            </motion.p>
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={viewportOnce}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="mt-9 flex flex-wrap justify-center gap-4"
            >
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
            </motion.div>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
