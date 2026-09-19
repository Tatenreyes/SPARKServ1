import Link from "next/link";
import { ArrowLeft, ArrowRight, CheckCircle2, Wrench } from "lucide-react";
import { notFound } from "next/navigation";
import { getServiceDetail } from "@/lib/service-details";

export function generateStaticParams() {
  return ["refrigerator", "air-conditioner", "washing-machine", "television", "electric-fan", "other-appliances"].map((slug) => ({ slug }));
}

export default function ServiceDetailPage({ params }: { params: { slug: string } }) {
  const service = getServiceDetail(params.slug);
  if (!service) notFound();

  return (
    <main className="min-h-[calc(100vh-4.5rem)] bg-canvas px-4 py-10 md:py-16">
      <div className="mx-auto max-w-5xl">
        <Link href="/#services" className="inline-flex items-center gap-2 text-sm font-semibold text-brand-700 transition hover:text-spark-600">
          <ArrowLeft className="h-4 w-4" /> Back to services
        </Link>

        <section className="mt-8 grid gap-8 overflow-hidden rounded-card border border-brand-100 bg-white shadow-card md:grid-cols-[1.1fr_0.9fr]">
          <div className="bg-brand-900 p-8 text-white md:p-12">
            <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-spark-300">
              <Wrench className="h-3.5 w-3.5" /> SPARKServ repair support
            </span>
            <h1 className="mt-6 font-display text-4xl font-semibold md:text-5xl">{service.name} Repair Support</h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-white/75">{service.description}</p>
            <Link href={`/customer/request-repair?appliance=${service.applianceType}`} className="spark-button-primary mt-8 h-12 bg-spark-400 text-brand-900 hover:bg-spark-300">
              Start a service inquiry <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </div>

          <div className="p-8 md:p-12">
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-spark-600">Common problems</p>
            <h2 className="mt-3 font-display text-2xl font-semibold text-ink">What needs attention?</h2>
            <div className="mt-6 space-y-3">
              {service.problems.map((problem) => (
                <Link
                  key={problem.issue}
                  href={`/customer/request-repair?appliance=${service.applianceType}&issue=${problem.issue}`}
                  className="group flex items-center justify-between rounded-lg border border-[#BFDBFE] bg-canvas px-4 py-4 text-sm font-semibold text-ink transition hover:-translate-y-0.5 hover:border-brand-300 hover:bg-brand-50 focus:outline-none focus:ring-2 focus:ring-brand-400"
                >
                  <span className="flex items-center gap-3"><CheckCircle2 className="h-4 w-4 text-brand-500" />{problem.label}</span>
                  <ArrowRight className="h-4 w-4 text-brand-500 transition group-hover:translate-x-1" />
                </Link>
              ))}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}