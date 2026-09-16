import { IconChat, IconScale, IconShieldCheck } from "@/components/icons";
import Image from "next/image";

interface AuthShellProps {
  headline: string;
  subhead: string;
  children: React.ReactNode;
}

export default function AuthShell({ children }: AuthShellProps) {
  return (
    <div className="grid min-h-[calc(100vh-80px)] md:grid-cols-[1.05fr_1fr]">
      <div className="relative hidden min-h-full overflow-hidden md:flex">
        <Image src="/images/Log in.jpg" alt="SPARKServ technician repairing a washing machine" fill priority sizes="(max-width: 1024px) 50vw, 55vw" className="object-cover object-center" />
        <div className="absolute inset-0 bg-gradient-to-r from-white/95 via-white/65 to-transparent" />
        <div className="relative z-10 flex max-w-md flex-col justify-center px-10 py-16 text-[#12233F] lg:px-14">
          <h1 className="font-display text-4xl font-bold leading-tight text-[#061B3B]">Good to see you again</h1>
          <p className="mt-4 max-w-xs text-base leading-7 text-[#66758C]">Log in to track your repair, review an estimate, or pick up where you left off.</p>
          <div className="mt-8 space-y-5">
            <Badge icon={<IconShieldCheck className="h-5 w-5" />} label="Trusted Technicians" detail="Background-checked and verified professionals." />
            <Badge icon={<IconChat className="h-5 w-5" />} label="Real-Time Updates" detail="Track your service status in real time." />
            <Badge icon={<IconScale className="h-5 w-5" />} label="Quality Service" detail="Reliable, professional and hassle-free." />
          </div>
        </div>
      </div>

      <div className="flex items-center justify-center bg-canvas px-5 py-16 md:px-8">{children}</div>
    </div>
  );
}

function Badge({ icon, label, detail }: { icon: React.ReactNode; label: string; detail?: string }) {
  return (
    <div className="flex items-start gap-3 text-sm">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#EAF4FF] text-[#0F52BA]">
        {icon}
      </span>
      <span><strong className="block font-semibold text-[#12233F]">{label}</strong>{detail && <small className="mt-1 block max-w-[190px] leading-5 text-[#66758C]">{detail}</small>}</span>
    </div>
  );
}
