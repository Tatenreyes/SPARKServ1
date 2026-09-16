import Link from "next/link";
import BrandLogo from "@/components/BrandLogo";

export default function Footer() {
  return (
    <footer className="border-t border-brand-800 bg-brand-900 text-white">
      <div className="spark-section py-12 md:py-16">
        <div className="grid gap-10 md:grid-cols-[1.3fr_0.9fr_0.9fr_1fr]">
          <div>
            <div className="flex items-center gap-2 font-display text-xl font-bold tracking-tight text-white">
              <BrandLogo size={32} className="rounded-lg" />
              SPARK<span className="text-spark-300">Serv</span>
            </div>
            <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.16em] text-spark-300">Appliance Repair &amp; Service</p>
            <p className="mt-4 max-w-sm text-sm leading-6 text-white/70">
              A modern appliance repair platform connecting customers to trusted technicians,
              transparent estimates, and easy repair tracking in Cagayan de Oro City.
            </p>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-spark-300">
              Get started
            </p>
            <ul className="mt-4 space-y-3 text-sm text-white/70">
              <li>
                  <Link href="/register" className="transition hover:text-spark-300">
                  Create an account
                </Link>
              </li>
              <li>
                  <Link href="/login" className="transition hover:text-spark-300">
                  Log in
                </Link>
              </li>
              <li>
                  <Link href="/services" className="transition hover:text-spark-300">
                  Explore services
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-spark-300">Services</p>
            <ul className="mt-4 space-y-3 text-sm text-white/70">
              <li><Link href="/services/washing-machine" className="transition hover:text-spark-300">Washing Machines</Link></li>
              <li><Link href="/services/refrigerator" className="transition hover:text-spark-300">Refrigerators</Link></li>
              <li><Link href="/services/air-conditioner" className="transition hover:text-spark-300">Air Conditioners</Link></li>
              <li><Link href="/services/other-appliances" className="transition hover:text-spark-300">Ovens &amp; Stoves</Link></li>
            </ul>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-spark-300">Contact</p>
            <ul className="mt-4 space-y-3 text-sm text-white/70">
              <li><a href="tel:+639123456789" className="transition hover:text-spark-300">+63 912 345 6789</a></li>
              <li><a href="mailto:support@sparkserv.com" className="transition hover:text-spark-300">support@sparkserv.com</a></li>
              <li>Cagayan de Oro City</li>
            </ul>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-spark-300">About</p>
            <p className="mt-4 text-sm leading-6 text-white/70">
              Built to support real appliance repair operations with clear requests, technician
              matching, and repair progress updates.
            </p>
          </div>
        </div>

        <div className="mt-10 flex flex-col gap-3 border-t border-white/15 pt-6 text-xs text-white/45 sm:flex-row sm:items-center sm:justify-between">
          <span>© 2026 SPARKServ. All rights reserved.</span>
          <span className="flex gap-4"><Link href="/policies/customer" className="hover:text-white">Privacy Policy</Link><Link href="/policies/customer" className="hover:text-white">Terms of Service</Link></span>
        </div>
      </div>
    </footer>
  );
}
