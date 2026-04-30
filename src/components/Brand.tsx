import { Globe } from "lucide-react";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import defaultLogo from "@/assets/logo-globe.png";

export function Brand({ className = "" }: { className?: string }) {
  const [logo, setLogo] = useState<string>(defaultLogo);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const { data } = await supabase.from("branding").select("logo_data_url").eq("id", "singleton").maybeSingle();
      if (active && data?.logo_data_url) setLogo(data.logo_data_url);
    };
    load();
    const channel = supabase
      .channel("branding-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "branding" }, (payload) => {
        const url = (payload.new as { logo_data_url?: string } | null)?.logo_data_url;
        if (url) setLogo(url);
        else setLogo(defaultLogo);
      })
      .subscribe();
    return () => { active = false; supabase.removeChannel(channel); };
  }, []);

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
