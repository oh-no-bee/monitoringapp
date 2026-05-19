import { useState, useRef, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { parseExcel } from "@/lib/excel";
import { runRules, type ClientResult } from "@/lib/rules";
import { exportExcel, exportPDF } from "@/lib/export";
import { Brand } from "@/components/Brand";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Upload, FileSpreadsheet, FileDown, Settings, AlertTriangle, ShieldAlert, TrendingUp, Users, Loader2, ChevronDown, ChevronRight, Trash2, Eye } from "lucide-react";
import { toast } from "sonner";
import { TriggerManager } from "@/components/TriggerManager";
import { RiskTrendChart } from "@/components/RiskTrendChart";
import { FlaggedClients } from "@/components/FlaggedClients";
import { WatchList } from "@/components/WatchList";
import { LogoManager } from "@/components/LogoManager";
import type { Tables } from "@/integrations/supabase/types";

const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const riskColors: Record<string, string> = {
  Critical: "bg-destructive text-destructive-foreground",
  High: "bg-accent text-accent-foreground",
  Medium: "bg-warning text-warning-foreground",
  Low: "bg-success text-success-foreground",
};

export function Dashboard() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [activePeriod, setActivePeriod] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [riskFilter, setRiskFilter] = useState("ALL");
  const [alertFilter, setAlertFilter] = useState("ALL");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [dirFilter, setDirFilter] = useState("ALL");
  const [currencyFilter, setCurrencyFilter] = useState("ALL");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [view, setView] = useState<"dashboard" | "flagged" | "watchlist">("dashboard");
  const [triggersOpen, setTriggersOpen] = useState(false);

  const { data: periods = [] } = useQuery({
    queryKey: ["periods"],
    queryFn: async () => {
      const { data, error } = await supabase.from("upload_periods").select("*").order("year", { ascending: false }).order("month", { ascending: false });
      if (error) throw error;
      if (data?.length && !activePeriod) setActivePeriod(data[0].id);
      return data as Tables<"upload_periods">[];
    },
  });

  const ALL_PERIODS = "__ALL__";

  const { data: settings = [] } = useQuery({
    queryKey: ["trigger_settings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("trigger_settings").select("*").order("trigger_key");
      if (error) throw error;
      return data as Tables<"trigger_settings">[];
    },
  });

  const { data: customs = [] } = useQuery({
    queryKey: ["custom_triggers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("custom_triggers").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data as Tables<"custom_triggers">[];
    },
  });

  // Realtime: when rules/settings/comments change anywhere, refresh on this device
  useEffect(() => {
    const channel = supabase
      .channel("rules-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "custom_triggers" },
        () => qc.invalidateQueries({ queryKey: ["custom_triggers"] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "trigger_settings" },
        () => qc.invalidateQueries({ queryKey: ["trigger_settings"] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "analyst_comments" },
        () => qc.invalidateQueries({ queryKey: ["analyst_comments"] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "upload_periods" },
        () => qc.invalidateQueries({ queryKey: ["periods"] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "watchlist_assignments" },
        () => qc.invalidateQueries({ queryKey: ["watchlist_assignments"] }))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [qc]);

  const { data: txns = [], isFetching: txnLoading } = useQuery({
    queryKey: ["txns", activePeriod],
    enabled: !!activePeriod,
    queryFn: async () => {
      const all: Tables<"transactions">[] = [];
      let from = 0; const step = 1000;
      const isAll = activePeriod === ALL_PERIODS;
      while (true) {
        let q = supabase.from("transactions").select("*").range(from, from + step - 1);
        if (!isAll) q = q.eq("period_id", activePeriod!);
        const { data, error } = await q;
        if (error) throw error;
        if (!data?.length) break;
        all.push(...(data as Tables<"transactions">[]));
        if (data.length < step) break;
        from += step;
      }
      return all;
    },
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const parsed = await parseExcel(file);
      const created: { id: string; label: string; count: number }[] = [];
      for (const period of parsed.periods) {
        const { data: existing } = await supabase.from("upload_periods").select("id").eq("period_key", period.periodKey).maybeSingle();
        let periodId = existing?.id;
        if (periodId) {
          await supabase.from("transactions").delete().eq("period_id", periodId);
          await supabase.from("upload_periods").update({ uploaded_at: new Date().toISOString(), filename: file.name, row_count: period.rows.length }).eq("id", periodId);
        } else {
          const { data, error } = await supabase.from("upload_periods").insert({
            period_key: period.periodKey, period_label: period.periodLabel,
            year: period.year, month: period.month,
            filename: file.name, row_count: period.rows.length,
          }).select("id").single();
          if (error) throw error;
          periodId = data.id;
        }
        const batch = 500;
        for (let i = 0; i < period.rows.length; i += batch) {
          const slice = period.rows.slice(i, i + batch).map((r) => ({ ...r, period_id: periodId! }));
          const { error } = await supabase.from("transactions").insert(slice);
          if (error) throw error;
        }
        created.push({ id: periodId!, label: period.periodLabel, count: period.rows.length });
      }
      return created;
    },
    onSuccess: (created) => {
      const summary = created.map((c) => `${c.label} (${c.count.toLocaleString()})`).join(", ");
      toast.success(`Loaded ${created.length} period${created.length > 1 ? "s" : ""}: ${summary}`);
      if (created.length) setActivePeriod(created[created.length - 1].id);
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message || "Upload failed"),
  });

  const deletePeriod = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("upload_periods").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Period removed"); setActivePeriod(null); qc.invalidateQueries({ queryKey: ["periods"] }); },
  });

  const dirTxns = dirFilter === "ALL"
    ? txns
    : txns.filter((t) => (t.direction || "").toUpperCase().startsWith(dirFilter));

  const results: ClientResult[] = dirTxns.length ? runRules(dirTxns, settings, customs) : [];

  const clientTypes = Array.from(new Set(results.map((r) => r.clientType).filter(Boolean))).sort();

  const filtered = results.filter((c) => {
    if (riskFilter !== "ALL" && c.riskLevel !== riskFilter) return false;
    if (typeFilter !== "ALL" && c.clientType !== typeFilter) return false;
    if (alertFilter === "CTR" && !c.hasCTR) return false;
    if (alertFilter === "SDA" && !c.hasSDA) return false;
    if (alertFilter === "BOTH" && !(c.hasCTR && c.hasSDA)) return false;
    if (alertFilter === "TRIG" && c.triggerCount === 0) return false;
    if (search && !c.clientName.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const stats = {
    total: results.length,
    critical: results.filter((r) => r.riskLevel === "Critical").length,
    ctr: results.filter((r) => r.hasCTR).length,
    sda: results.filter((r) => r.hasSDA).length,
    triggers: results.reduce((a, r) => a + r.triggerCount, 0),
  };

  const activePeriodObj = periods.find((p) => p.id === activePeriod);
  const periodLabel = activePeriod === ALL_PERIODS ? "All Months Combined" : (activePeriodObj?.period_label || "Current");

  const toggle = (k: string) => {
    const n = new Set(expanded);
    n.has(k) ? n.delete(k) : n.add(k);
    setExpanded(n);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-[var(--gradient-brand)] shadow-[var(--shadow-elegant)]">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between px-6 py-4">
          <Brand />
          <div className="flex items-center gap-2">
            <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.currentTarget.value = ""; }} />
            <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()} disabled={upload.isPending}>
              {upload.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              Upload Excel
            </Button>
            <LogoManager />
            <Sheet open={triggersOpen} onOpenChange={setTriggersOpen}>
              <SheetTrigger asChild>
                <Button variant="secondary" size="sm"><Settings className="mr-2 h-4 w-4" />Triggers</Button>
              </SheetTrigger>
              <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
                <SheetHeader><SheetTitle>Trigger & Rule Engine</SheetTitle></SheetHeader>
                <TriggerManager settings={settings} customs={customs} />
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] px-6 py-6 space-y-6">
        {/* Top-level view switcher */}
        {periods.length > 0 && (
          <Tabs value={view} onValueChange={(v) => setView(v as typeof view)}>
            <TabsList className="bg-muted/60">
              <TabsTrigger value="dashboard" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground transition-all">
                <Users className="mr-2 h-4 w-4" /> Compliance Dashboard
              </TabsTrigger>
              <TabsTrigger value="flagged" className="data-[state=active]:bg-destructive data-[state=active]:text-destructive-foreground transition-all">
                <ShieldAlert className="mr-2 h-4 w-4" /> Flagged Clients
                {results.filter((r) => r.riskLevel === "Critical" || r.riskLevel === "High").length > 0 && (
                  <span className="ml-2 rounded-full bg-background/20 px-1.5 py-0.5 text-[10px] font-bold animate-pulse">
                    {results.filter((r) => r.riskLevel === "Critical" || r.riskLevel === "High").length}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="watchlist" className="data-[state=active]:bg-accent data-[state=active]:text-accent-foreground transition-all">
                <Eye className="mr-2 h-4 w-4" /> Watch List
              </TabsTrigger>
            </TabsList>
          </Tabs>
        )}

        {/* Period tabs */}
        {periods.length > 0 ? (
          <Card className="p-3">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-xs uppercase tracking-wider font-semibold text-muted-foreground pl-2">Reporting Period</span>
              <Tabs value={activePeriod ?? ""} onValueChange={setActivePeriod} className="flex-1 min-w-0">
                <TabsList className="flex-wrap h-auto bg-muted/60">
                  {periods.map((p) => (
                    <TabsTrigger key={p.id} value={p.id} className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                      {p.period_label} <span className="ml-2 text-[10px] opacity-60">{p.row_count}</span>
                    </TabsTrigger>
                  ))}
                  {periods.length > 1 && (
                    <TabsTrigger value={ALL_PERIODS} className="data-[state=active]:bg-accent data-[state=active]:text-accent-foreground">
                      All Months <span className="ml-2 text-[10px] opacity-60">{periods.reduce((a, p) => a + (p.row_count || 0), 0)}</span>
                    </TabsTrigger>
                  )}
                </TabsList>
              </Tabs>
              {activePeriodObj && activePeriod !== ALL_PERIODS && (
                <Button size="sm" variant="ghost" onClick={() => { if (confirm(`Delete ${activePeriodObj.period_label}?`)) deletePeriod.mutate(activePeriodObj.id); }}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              )}
            </div>
          </Card>
        ) : (
          <Card className="p-12 text-center border-dashed">
            <FileSpreadsheet className="mx-auto h-12 w-12 text-muted-foreground mb-3" />
            <h2 className="font-display text-2xl mb-2">No data yet</h2>
            <p className="text-muted-foreground mb-4">Upload your monthly transactions Excel to begin compliance screening.</p>
            <Button onClick={() => fileRef.current?.click()} disabled={upload.isPending}>
              {upload.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              Upload Excel File
            </Button>
            <p className="text-xs text-muted-foreground mt-3">The reporting month is auto-detected from the Date column.</p>
          </Card>
        )}

        {activePeriod && view === "flagged" && (
          <FlaggedClients
            results={results}
            periodLabel={periodLabel}
            onOpenTriggers={() => setTriggersOpen(true)}
          />
        )}

        {periods.length > 0 && view === "watchlist" && (
          <WatchList periods={periods} onOpenTriggers={() => setTriggersOpen(true)} />
        )}

        {activePeriod && view === "dashboard" && (
          <>
            {periods.length > 0 && <RiskTrendChart periods={periods} settings={settings} customs={customs} />}
            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <StatCard icon={Users} label="Clients" value={stats.total} tone="primary" />
              <StatCard icon={ShieldAlert} label="Critical Risk" value={stats.critical} tone="destructive" />
              <StatCard icon={AlertTriangle} label="CTR Alerts" value={stats.ctr} tone="ctr" />
              <StatCard icon={AlertTriangle} label="SDA Alerts" value={stats.sda} tone="sda" />
              <StatCard icon={TrendingUp} label="Triggers Hit" value={stats.triggers} tone="accent" />
            </div>

            {/* Filters */}
            <Card className="p-4">
              <div className="flex flex-wrap items-center gap-3">
                <Input placeholder="Search client name…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
                <Select value={riskFilter} onValueChange={setRiskFilter}>
                  <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All Risk Levels</SelectItem>
                    <SelectItem value="Critical">Critical</SelectItem>
                    <SelectItem value="High">High</SelectItem>
                    <SelectItem value="Medium">Medium</SelectItem>
                    <SelectItem value="Low">Low</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={alertFilter} onValueChange={setAlertFilter}>
                  <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All Alerts</SelectItem>
                    <SelectItem value="TRIG">With Triggers</SelectItem>
                    <SelectItem value="CTR">CTR Only</SelectItem>
                    <SelectItem value="SDA">SDA Only</SelectItem>
                    <SelectItem value="BOTH">CTR + SDA</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={typeFilter} onValueChange={setTypeFilter}>
                  <SelectTrigger className="w-[170px]"><SelectValue placeholder="Client Type" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All Client Types</SelectItem>
                    {clientTypes.map((t) => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={dirFilter} onValueChange={setDirFilter}>
                  <SelectTrigger className="w-[150px]"><SelectValue placeholder="Direction" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">Buy & Sell</SelectItem>
                    <SelectItem value="B">Buy only</SelectItem>
                    <SelectItem value="S">Sell only</SelectItem>
                  </SelectContent>
                </Select>
                <div className="flex-1" />
                <Button variant="outline" size="sm" onClick={() => exportExcel(filtered, periodLabel)} disabled={!filtered.length}>
                  <FileDown className="mr-2 h-4 w-4" />Excel
                </Button>
                <Button size="sm" onClick={() => exportPDF(filtered, periodLabel)} disabled={!filtered.length}>
                  <FileDown className="mr-2 h-4 w-4" />PDF Report
                </Button>
              </div>
            </Card>

            {/* Results table */}
            <Card className="overflow-hidden">
              {txnLoading ? (
                <div className="p-12 text-center text-muted-foreground"><Loader2 className="mx-auto h-6 w-6 animate-spin mb-2" />Loading transactions…</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-secondary/60">
                      <tr className="text-left">
                        <th className="px-3 py-2 w-8"></th>
                        <th className="px-3 py-2">Client</th>
                        <th className="px-3 py-2">Type</th>
                        <th className="px-3 py-2 text-right">Total (ZAR)</th>
                        <th className="px-3 py-2 text-center">Txns</th>
                        <th className="px-3 py-2">Risk</th>
                        <th className="px-3 py-2">Alerts</th>
                        <th className="px-3 py-2 text-center">Triggers</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((c) => {
                        const isOpen = expanded.has(c.clientName);
                        return (
                          <>
                            <tr key={c.clientName} className="border-t hover:bg-muted/40 cursor-pointer" onClick={() => toggle(c.clientName)}>
                              <td className="px-3 py-2">{isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</td>
                              <td className="px-3 py-2 font-medium">{c.clientName}</td>
                              <td className="px-3 py-2 text-muted-foreground">{c.clientType}</td>
                              <td className="px-3 py-2 text-right font-mono">{fmt(c.totalZAR)}</td>
                              <td className="px-3 py-2 text-center">{c.txnCount}</td>
                              <td className="px-3 py-2"><Badge className={riskColors[c.riskLevel]}>{c.riskLevel}</Badge></td>
                              <td className="px-3 py-2">
                                {c.hasCTR && <Badge className="mr-1 bg-ctr text-white">CTR</Badge>}
                                {c.hasSDA && <Badge className="bg-sda text-white">SDA</Badge>}
                              </td>
                              <td className="px-3 py-2 text-center">
                                <span className="font-semibold text-accent">{c.triggerCount}</span>
                              </td>
                            </tr>
                            {isOpen && (
                              <tr key={`${c.clientName}-d`} className="bg-muted/30">
                                <td></td>
                                <td colSpan={7} className="px-3 py-3">
                                  <div className="space-y-3">
                                    {c.triggers.length > 0 && (
                                      <div className="flex flex-wrap gap-1.5">
                                        {c.triggers.map((t) => (
                                          <span key={t.key} className="inline-flex items-center rounded-md bg-accent/10 text-accent border border-accent/20 px-2 py-0.5 text-xs font-medium">
                                            {t.label}
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                    <div className="overflow-x-auto rounded-md border bg-background">
                                      <table className="w-full text-xs">
                                        <thead className="bg-secondary/50"><tr className="text-left">
                                          <th className="px-2 py-1.5">Date</th><th className="px-2 py-1.5">Deal</th>
                                          <th className="px-2 py-1.5">Product</th><th className="px-2 py-1.5">Currency</th>
                                          <th className="px-2 py-1.5">Dir</th><th className="px-2 py-1.5 text-right">Total</th>
                                          <th className="px-2 py-1.5">Sanc Check</th>
                                        </tr></thead>
                                        <tbody>
                                          {c.txns.map((t, i) => (
                                            <tr key={i} className="border-t">
                                              <td className="px-2 py-1">{t.txn_date}</td>
                                              <td className="px-2 py-1 font-mono">{t.deal_code}</td>
                                              <td className="px-2 py-1">{t.product}</td>
                                              <td className="px-2 py-1">{t.currency}</td>
                                              <td className="px-2 py-1">{t.direction}</td>
                                              <td className="px-2 py-1 text-right font-mono">{fmt(Number(t.total))}</td>
                                              <td className="px-2 py-1">{t.sanction_check}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </>
                        );
                      })}
                      {!filtered.length && (
                        <tr><td colSpan={8} className="px-3 py-12 text-center text-muted-foreground">No clients match the current filters.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </>
        )}
      </main>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, tone }: { icon: React.ElementType; label: string; value: number; tone: string }) {
  const tones: Record<string, string> = {
    primary: "from-primary to-primary-glow",
    destructive: "from-destructive to-destructive",
    ctr: "from-ctr to-destructive",
    sda: "from-sda to-warning",
    accent: "from-accent to-accent-glow",
  };
  return (
    <Card className="p-4 overflow-hidden relative transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[var(--shadow-elegant)] animate-fade-in">
      <div className={`absolute -right-4 -top-4 h-20 w-20 rounded-full bg-gradient-to-br ${tones[tone]} opacity-10`} />
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
          <div className="mt-1 font-display text-3xl font-bold">{value.toLocaleString()}</div>
        </div>
        <Icon className={`h-5 w-5 text-${tone === "primary" ? "primary" : tone === "destructive" ? "destructive" : tone === "ctr" ? "ctr" : tone === "sda" ? "sda" : "accent"}`} />
      </div>
    </Card>
  );
}
