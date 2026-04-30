import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Image as ImageIcon, Upload, Download, RotateCcw, Loader2 } from "lucide-react";
import { toast } from "sonner";
import defaultLogo from "@/assets/logo-globe.png";

const MAX_SIZE = 1_500_000; // ~1.5 MB raw before base64

export function LogoManager() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.from("branding").select("logo_data_url").eq("id", "singleton").maybeSingle()
      .then(({ data }) => setCurrent(data?.logo_data_url ?? null));
  }, []);

  const onPick = async (file: File) => {
    if (!file.type.startsWith("image/")) { toast.error("Please choose an image file"); return; }
    if (file.size > MAX_SIZE) { toast.error("Logo must be under 1.5 MB"); return; }
    setBusy(true);
    try {
      const dataUrl: string = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = reject;
        r.readAsDataURL(file);
      });
      const { error } = await supabase
        .from("branding")
        .upsert({ id: "singleton", logo_data_url: dataUrl, updated_at: new Date().toISOString() });
      if (error) throw error;
      setCurrent(dataUrl);
      toast.success("Logo updated — synced to all devices");
    } catch (e) {
      toast.error((e as Error).message || "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  const exportLogo = async () => {
    const src = current || defaultLogo;
    const a = document.createElement("a");
    a.href = src;
    a.download = "gfx-logo.png";
    a.click();
  };

  const resetLogo = async () => {
    if (!confirm("Reset to the default logo?")) return;
    setBusy(true);
    const { error } = await supabase
      .from("branding")
      .upsert({ id: "singleton", logo_data_url: null, updated_at: new Date().toISOString() });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    setCurrent(null);
    toast.success("Logo reset to default");
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="secondary" size="sm">
          <ImageIcon className="mr-2 h-4 w-4" /> Logo
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <div className="space-y-3">
          <div>
            <div className="text-sm font-semibold">Brand Logo</div>
            <p className="text-xs text-muted-foreground">PNG or JPG, transparent recommended, &lt; 1.5 MB. Synced across all devices.</p>
          </div>
          <div className="flex items-center justify-center rounded-md border bg-muted/40 p-3 h-24">
            <img src={current || defaultLogo} alt="Current logo" className="max-h-full max-w-full object-contain" />
          </div>
          <input
            ref={fileRef} type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); e.currentTarget.value = ""; }}
          />
          <div className="grid grid-cols-2 gap-2">
            <Button size="sm" onClick={() => fileRef.current?.click()} disabled={busy}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              Upload
            </Button>
            <Button size="sm" variant="outline" onClick={exportLogo}>
              <Download className="mr-2 h-4 w-4" /> Export
            </Button>
          </div>
          <Button size="sm" variant="ghost" className="w-full" onClick={resetLogo} disabled={busy}>
            <RotateCcw className="mr-2 h-4 w-4" /> Reset to default
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
