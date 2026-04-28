import { Globe } from "lucide-react";
import logo from "@/assets/logo-globe.png";

export function Brand({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <div className="relative h-11 w-11 rounded-full bg-gradient-to-br from-accent to-accent-glow p-1.5 shadow-[var(--shadow-elegant)]">
        <img src={logo} alt="GFX globe" className="h-full w-full object-contain" />
      </div>
      <div className="leading-tight">
        <div className="font-display text-lg font-bold text-primary-foreground">Global Foreign Exchange</div>
        <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.2em] text-primary-foreground/70">
          <Globe className="h-3 w-3" /> Ongoing Monitoring
        </div>
      </div>
    </div>
  );
}
