import { Globe } from "lucide-react";
import logo from "@/assets/logo-globe.png";

export function Brand({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <div className="relative h-14 w-14 shrink-0">
        <img src={logo} alt="Global Foreign Exchange logo" className="h-full w-full object-contain" />
      </div>
      <div className="leading-tight">
        <div className="font-display text-lg font-bold text-foreground">Global Foreign Exchange</div>
        <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.2em] text-foreground/70">
          <Globe className="h-3 w-3" /> Ongoing Monitoring
        </div>
      </div>
    </div>
  );
}
