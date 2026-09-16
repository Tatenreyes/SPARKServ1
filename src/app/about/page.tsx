import Link from "next/link";
import { ArrowRight, CheckCircle2, ShieldCheck, UsersRound } from "lucide-react";
import Footer from "@/components/Footer";

export default function AboutPage() {
  return (
    <main className="bg-[#EFF6FF]">
      <section className="bg-brand-900 px-4 py-16 text-white md:py-24"><div className="mx-auto max-w-5xl"><p className="text-xs font-bold uppercase tracking-[0.18em] text-spark-300">About SPARKServ</p><h1 className="mt-4 max-w-2xl text-4xl font-semibold leading-tight md:text-6xl">Service that feels organized from the start.</h1><p className="mt-5 max-w-xl text-base leading-7 text-white/70">SPARKServ brings customers, technicians, and repair operations into one dependable platform for Cagayan de Oro City and beyond.</p></div></section>
      <section className="mx-auto grid max-w-5xl gap-5 px-4 py-12 md:grid-cols-3 md:py-16"><article className="rounded-card border border-brand-200 bg-white p-6"><ShieldCheck className="h-6 w-6 text-brand-600" /><h2 className="mt-5 text-xl font-semibold text-slate-950">Built on trust</h2><p className="mt-2 text-sm leading-6 text-slate-600">Technician profiles, estimates, and progress updates stay clear and easy to review.</p></article><article className="rounded-card border border-brand-200 bg-white p-6"><UsersRound className="h-6 w-6 text-brand-600" /><h2 className="mt-5 text-xl font-semibold text-slate-950">Made for real people</h2><p className="mt-2 text-sm leading-6 text-slate-600">Customers get convenience while technicians get a better way to manage their work.</p></article><article className="rounded-card border border-brand-200 bg-white p-6"><CheckCircle2 className="h-6 w-6 text-brand-600" /><h2 className="mt-5 text-xl font-semibold text-slate-950">Clear at every step</h2><p className="mt-2 text-sm leading-6 text-slate-600">From inquiry to service history, important details are kept in one place.</p></article></section>
      <section className="mx-auto max-w-5xl px-4 pb-16"><div className="rounded-card bg-white p-7 md:p-10"><h2 className="text-2xl font-semibold text-slate-950">Let’s get your repair moving.</h2><p className="mt-2 max-w-xl text-sm leading-6 text-slate-600">Start with a service inquiry and let SPARKServ guide you to the right next step.</p><Link href="/customer/inquiry" className="spark-button-primary mt-6">Start a service inquiry <ArrowRight className="ml-2 h-4 w-4" /></Link></div></section>
      <Footer />
    </main>
  );
}
