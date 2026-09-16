import Link from "next/link";
import { Mail, MapPin, Phone } from "lucide-react";
import Footer from "@/components/Footer";

export default function ContactPage() {
  return (
    <main className="bg-[#F6F9FC]">
      <section className="bg-[#082653] px-4 py-16 text-white md:py-24">
        <div className="mx-auto max-w-5xl">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#87C5FF]">Contact SPARKServ</p>
          <h1 className="mt-4 max-w-2xl text-4xl font-bold leading-tight md:text-6xl">Reliable help is only a message away.</h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-white/70">Tell us what you need and our team will help you find the right next step for your home appliance.</p>
        </div>
      </section>
      <section className="mx-auto grid max-w-5xl gap-5 px-4 py-12 sm:grid-cols-3 md:py-20">
        <ContactCard icon={Phone} label="Call for support" value="+63 912 345 6789" href="tel:+639123456789" />
        <ContactCard icon={Mail} label="Email us" value="support@sparkserv.com" href="mailto:support@sparkserv.com" />
        <ContactCard icon={MapPin} label="Service area" value="Cagayan de Oro City" />
      </section>
      <div className="mx-auto max-w-5xl px-4 pb-16"><Link href="/customer/inquiry" className="inline-flex rounded-lg bg-[#0F52BA] px-6 py-3 text-sm font-bold text-white">Book a Service</Link></div>
      <Footer />
    </main>
  );
}

function ContactCard({ icon: Icon, label, value, href }: { icon: typeof Phone; label: string; value: string; href?: string }) {
  const content = <><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#EAF4FF] text-[#0F52BA]"><Icon className="h-5 w-5" /></span><span><small className="block text-xs font-semibold uppercase tracking-wide text-[#66758C]">{label}</small><strong className="mt-1 block text-sm text-[#061B3B]">{value}</strong></span></>;
  return href ? <a href={href} className="flex items-center gap-4 rounded-xl border border-[#DDEBFA] bg-white p-5 shadow-sm transition hover:-translate-y-1">{content}</a> : <div className="flex items-center gap-4 rounded-xl border border-[#DDEBFA] bg-white p-5 shadow-sm">{content}</div>;
}
