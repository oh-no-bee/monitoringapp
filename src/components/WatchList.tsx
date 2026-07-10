import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Eye, AlertTriangle, CheckCircle2, Plus, Tag, Sparkles } from "lucide-react";
import { toast } from "sonner";
import type { Tables } from "@/integrations/supabase/types";

const fmt = (n: number) =>
  "R" + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface MonthRow {
  periodId: string;
  label: string;
  periodKey: string; // YYYY-MM
  total: number;
  count: number;
  zScore: number; // anomaly score vs client's own history
  isAnomaly: boolean;
}
interface WatchClient {
  name: string;
  type: string;
  totalZAR: number;
  totalTxns: number;
  monthsActive: number;
  months: MonthRow[];
  lastSeenKey: string;
  missedLastMonth: boolean;
  isNewThisMonth: boolean;
  // Consistency / watch-trail
  currentStreak: number;      // consecutive most-recent months active
  longestStreak: number;
  missedCount: number;        // periods where client had 0 activity
  consistencyPct: number;     // monthsActive / total periods (0-100)
  isConsistent: boolean;      // active in every uploaded period
  // ML insights
  meanMonthly: number;
  stdMonthly: number;
  trend: "rising" | "falling" | "stable";
  anomalyScore: number;
  mlInsight: string;
}

export function WatchList({
  periods,
  onOpenTriggers,
}: {
  periods: Tables<"upload_periods">[];
  onOpenTriggers: () => void;
}) {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<"ALL" | "ACTIVE" | "MISSED" | "NEW" | "CONSISTENT">("ALL");
  const [search, setSearch] = useState("");

  // pull all txns for all periods limited to LI/MCPI
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["watchlist-txns"],
    queryFn: async () => {
      const all: Tables<"transactions">[] = [];
      let from = 0; const step = 1000;
      while (true) {
        const { data, error } = await supabase
          .from("transactions")
          .select("client_name,client_type,total,currency,txn_date,period_id")
          .in("client_type", ["LI", "MCPI"])
          .range(from, from + step - 1);
        if (error) throw error;
        if (!data?.length) break;
        all.push(...(data as Tables<"transactions">[]));
        if (data.length < step) break;
        from += step;
      }
      return all;
    },
  });

  const { data: settings = [] } = useQuery({
    queryKey: ["trigger_settings"],
    queryFn: async () => {
      const { data } = await supabase.from("trigger_settings").select("*").order("trigger_key");
      return (data || []) as Tables<"trigger_settings">[];
    },
  });
  const { data: customs = [] } = useQuery({
    queryKey: ["custom_triggers"],
    queryFn: async () => {
      const { data } = await supabase.from("custom_triggers").select("*").order("created_at", { ascending: false });
      return (data || []) as Tables<"custom_triggers">[];
    },
  });
  const { data: assignments = [] } = useQuery({
    queryKey: ["watchlist_assignments"],
    queryFn: async () => {
      const { data } = await supabase.from("watchlist_assignments").select("*");
      return (data || []) as Tables<"watchlist_assignments">[];
    },
  });

  const periodMap = useMemo(() => {
    const m = new Map<string, Tables<"upload_periods">>();
    for (const p of periods) m.set(p.id, p);
    return m;
  }, [periods]);

  // All uploaded periods sorted chronologically (YYYY-MM)
  const allPeriodKeys = useMemo(
    () =>
      periods
        .slice()
        .sort((a, b) => (a.year - b.year) || (a.month - b.month))
        .map((p) => `${p.year}-${String(p.month).padStart(2, "0")}`),
    [periods],
  );
  const periodByKey = useMemo(() => {
    const m = new Map<string, Tables<"upload_periods">>();
    for (const p of periods) m.set(`${p.year}-${String(p.month).padStart(2, "0")}`, p);
    return m;
  }, [periods]);
  const latestKey = allPeriodKeys[allPeriodKeys.length - 1];

  const clients: WatchClient[] = useMemo(() => {
    const byClient = new Map<string, { type: string; months: Map<string, MonthRow>; totalZAR: number; totalTxns: number }>();
    for (const r of rows) {
      const name = r.client_name || "(unknown)";
      if (!byClient.has(name)) byClient.set(name, { type: (r.client_type || "").toUpperCase(), months: new Map(), totalZAR: 0, totalTxns: 0 });
      const entry = byClient.get(name)!;
      const periodId = r.period_id!;
      const period = periodMap.get(periodId);
      if (!period) continue;
      const periodKey = `${period.year}-${String(period.month).padStart(2, "0")}`;
      if (!entry.months.has(periodKey)) {
        entry.months.set(periodKey, { periodId, label: period.period_label, periodKey, total: 0, count: 0, zScore: 0, isAnomaly: false });
      }
      const mrow = entry.months.get(periodKey)!;
      const v = Number(r.total) || 0;
      mrow.total += v;
      mrow.count += 1;
      entry.totalZAR += v;
      entry.totalTxns += 1;
    }
    const out: WatchClient[] = [];
    for (const [name, e] of byClient) {
      const months = Array.from(e.months.values()).sort((a, b) => a.periodKey.localeCompare(b.periodKey));
      const lastSeenKey = months[months.length - 1]?.periodKey ?? "";
      const missedLastMonth = !!latestKey && lastSeenKey !== latestKey;
      const isNewThisMonth = months.length === 1 && lastSeenKey === latestKey;

      // === Consistency / streak across ALL uploaded periods ===
      const activeSet = new Set(months.map((m) => m.periodKey));
      const totalPeriods = allPeriodKeys.length;
      const missedCount = totalPeriods - activeSet.size;
      const consistencyPct = totalPeriods ? Math.round((activeSet.size / totalPeriods) * 100) : 0;
      const isConsistent = totalPeriods > 1 && activeSet.size === totalPeriods;
      let longestStreak = 0, currentStreak = 0;
      let run = 0;
      for (const k of allPeriodKeys) {
        if (activeSet.has(k)) { run++; if (run > longestStreak) longestStreak = run; }
        else run = 0;
      }
      // current streak = trailing consecutive months active
      for (let i = allPeriodKeys.length - 1; i >= 0; i--) {
        if (activeSet.has(allPeriodKeys[i])) currentStreak++;
        else break;
      }

      // === Anomaly detection on per-client monthly totals ===
      const totals = months.map((m) => m.total);
      const n = totals.length;
      const meanMonthly = n ? totals.reduce((a, b) => a + b, 0) / n : 0;
      const variance = n > 1 ? totals.reduce((a, b) => a + (b - meanMonthly) ** 2, 0) / (n - 1) : 0;
      const stdMonthly = Math.sqrt(variance);
      let maxAbsZ = 0;
      for (const m of months) {
        m.zScore = stdMonthly > 0 ? (m.total - meanMonthly) / stdMonthly : 0;
        m.isAnomaly = stdMonthly > 0 && Math.abs(m.zScore) >= 2;
        if (Math.abs(m.zScore) > maxAbsZ) maxAbsZ = Math.abs(m.zScore);
      }
      let trend: WatchClient["trend"] = "stable";
      if (n >= 3) {
        const xs = totals.map((_, i) => i);
        const xMean = xs.reduce((a, b) => a + b, 0) / n;
        const num = xs.reduce((a, x, i) => a + (x - xMean) * (totals[i] - meanMonthly), 0);
        const den = xs.reduce((a, x) => a + (x - xMean) ** 2, 0);
        const slope = den ? num / den : 0;
        const rel = meanMonthly > 0 ? slope / meanMonthly : 0;
        if (rel > 0.15) trend = "rising";
        else if (rel < -0.15) trend = "falling";
      }
      const missedPenalty = missedLastMonth ? 25 : 0;
      const newPenalty = isNewThisMonth ? 15 : 0;
      const zPenalty = Math.min(60, Math.round(maxAbsZ * 20));
      const trendPenalty = trend === "rising" ? 15 : 0;
      const gapPenalty = Math.min(20, missedCount * 5);
      const anomalyScore = Math.min(100, missedPenalty + newPenalty + zPenalty + trendPenalty + gapPenalty);

      const spikeMonth = months.find((m) => m.zScore >= 2);
      const dropMonth = months.find((m) => m.zScore <= -2);
      const parts: string[] = [];
      if (isConsistent) parts.push(`transacting every month for ${totalPeriods} consecutive periods — highly consistent`);
      else if (currentStreak >= 3) parts.push(`on a ${currentStreak}-month active streak`);
      if (spikeMonth) parts.push(`unusual spike in ${spikeMonth.label} (${spikeMonth.zScore.toFixed(1)}σ above their norm)`);
      if (dropMonth) parts.push(`sharp drop in ${dropMonth.label}`);
      if (trend === "rising") parts.push(`monthly volume trending up`);
      if (trend === "falling") parts.push(`monthly volume trending down`);
      if (missedLastMonth && n >= 2) parts.push(`missed last reporting month after ${n} active month${n === 1 ? "" : "s"}`);
      if (missedCount >= 2 && !isNewThisMonth) parts.push(`${missedCount} gap month${missedCount === 1 ? "" : "s"} in trail (${consistencyPct}% consistency)`);
      if (isNewThisMonth) parts.push(`newly onboarded this month — no behavioural baseline yet`);
      const mlInsight = parts.length
        ? `Model: ${parts.join("; ")}.`
        : `Model: behaviour within normal range (μ ${meanMonthly.toFixed(0)}, σ ${stdMonthly.toFixed(0)}).`;

      out.push({
        name, type: e.type, totalZAR: e.totalZAR, totalTxns: e.totalTxns,
        monthsActive: months.length, months, lastSeenKey, missedLastMonth, isNewThisMonth,
        currentStreak, longestStreak, missedCount, consistencyPct, isConsistent,
        meanMonthly, stdMonthly, trend, anomalyScore, mlInsight,
      });
    }
    return out.sort((a, b) => b.anomalyScore - a.anomalyScore || b.totalZAR - a.totalZAR);
  }, [rows, periodMap, latestKey, allPeriodKeys]);


  const filtered = clients.filter((c) => {
    if (search && !c.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (filter === "ACTIVE") return !c.missedLastMonth;
    if (filter === "MISSED") return c.missedLastMonth && c.monthsActive > 0;
    if (filter === "NEW") return c.isNewThisMonth;
    if (filter === "CONSISTENT") return c.isConsistent || c.currentStreak >= 3;
    return true;
  });

  const stats = {
    total: clients.length,
    active: clients.filter((c) => !c.missedLastMonth).length,
    missed: clients.filter((c) => c.missedLastMonth).length,
    new: clients.filter((c) => c.isNewThisMonth).length,
    consistent: clients.filter((c) => c.isConsistent || c.currentStreak >= 3).length,
  };

  const upsertAssignment = useMutation({
    mutationFn: async ({ clientName, triggerKey, enabled, note }: { clientName: string; triggerKey: string; enabled: boolean; note?: string }) => {
      const { error } = await supabase.from("watchlist_assignments").upsert({
        client_name: clientName, trigger_key: triggerKey, enabled, note: note ?? null, updated_at: new Date().toISOString(),
      } as never, { onConflict: "client_name,trigger_key" });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Trigger assigned"); qc.invalidateQueries({ queryKey: ["watchlist_assignments"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) {
    return <Card className="p-12 text-center text-muted-foreground">Loading watch-list…</Card>;
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Eye className="h-5 w-5 text-primary" />
            <div>
              <div className="font-display text-lg font-bold leading-tight">Watch List · LI &amp; MCPI</div>
              <div className="text-xs text-muted-foreground">
                Monthly transacting behaviour for individual money-changer and local-individual clients across all uploaded periods.
              </div>
            </div>
          </div>
          <div className="flex-1" />
          <Input placeholder="Search client…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
        </div>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <FilterChip active={filter === "ALL"} onClick={() => setFilter("ALL")} label="All clients" value={stats.total} icon={Eye} tone="primary" />
        <FilterChip active={filter === "ACTIVE"} onClick={() => setFilter("ACTIVE")} label="Active this month" value={stats.active} icon={CheckCircle2} tone="success" />
        <FilterChip active={filter === "MISSED"} onClick={() => setFilter("MISSED")} label="Missed last month" value={stats.missed} icon={AlertTriangle} tone="destructive" pulse={stats.missed > 0} />
        <FilterChip active={filter === "NEW"} onClick={() => setFilter("NEW")} label="New this month" value={stats.new} icon={Sparkles} tone="accent" />
      </div>

      {filtered.length === 0 ? (
        <Card className="p-12 text-center text-muted-foreground">No clients match the current filter.</Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((c, idx) => {
            const myAssignments = assignments.filter((a) => a.client_name === c.name && a.enabled);
            return (
              <Card
                key={c.name}
                className="p-4 transition-all duration-300 hover:shadow-[var(--shadow-elegant)] hover:-translate-y-0.5 animate-fade-in border-l-4"
                style={{
                  borderLeftColor: c.missedLastMonth ? "hsl(var(--destructive))" : c.isNewThisMonth ? "hsl(var(--accent))" : "hsl(var(--primary))",
                  animationDelay: `${Math.min(idx * 30, 300)}ms`,
                }}
              >
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-display text-lg font-bold">{c.name}</h3>
                      <Badge variant="outline" className="font-mono">{c.type}</Badge>
                      {c.missedLastMonth && (
                        <Badge className="bg-destructive text-destructive-foreground animate-pulse">
                          <AlertTriangle className="mr-1 h-3 w-3" />Missed last month
                        </Badge>
                      )}
                      {c.isNewThisMonth && <Badge className="bg-accent text-accent-foreground">New</Badge>}
                      {!c.missedLastMonth && !c.isNewThisMonth && (
                        <Badge className="bg-success text-success-foreground"><CheckCircle2 className="mr-1 h-3 w-3" />Active</Badge>
                      )}
                      {c.trend === "rising" && <Badge className="bg-warning text-warning-foreground">↑ Trending up</Badge>}
                      {c.trend === "falling" && <Badge variant="outline">↓ Cooling off</Badge>}
                      {c.anomalyScore >= 50 && (
                        <Badge className="bg-destructive/90 text-destructive-foreground animate-pulse">
                          <Sparkles className="mr-1 h-3 w-3" />ML anomaly {c.anomalyScore}
                        </Badge>
                      )}
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      {c.totalTxns} txn · Lifetime <span className="font-mono font-semibold text-foreground">{fmt(c.totalZAR)}</span> · Active in {c.monthsActive} month{c.monthsActive === 1 ? "" : "s"} · Avg <span className="font-mono">{fmt(c.meanMonthly)}</span>/mo
                    </div>
                    <div className="mt-2 rounded-md bg-accent/5 border border-accent/20 px-2.5 py-1.5 text-xs text-foreground/90 italic">
                      <Sparkles className="inline-block h-3 w-3 mr-1 text-accent" />{c.mlInsight}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <AssignTriggerDialog
                      clientName={c.name}
                      settings={settings}
                      customs={customs}
                      assignments={assignments.filter((a) => a.client_name === c.name)}
                      onSave={(args) => upsertAssignment.mutate(args)}
                    />
                    <Button size="sm" variant="ghost" onClick={onOpenTriggers}>Edit triggers</Button>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {c.months.map((m) => (
                    <span
                      key={m.periodKey}
                      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium border transition-colors ${
                        m.isAnomaly
                          ? "bg-destructive/10 text-destructive border-destructive/40"
                          : m.periodKey === latestKey
                            ? "bg-primary/15 text-primary border-primary/30"
                            : "bg-muted/60 text-foreground border-border"
                      }`}
                      title={m.isAnomaly ? `Anomaly: ${m.zScore.toFixed(2)}σ from this client's normal monthly volume` : undefined}
                    >
                      <span className="font-semibold">{m.label}</span>
                      <span className="opacity-70">· {m.count} txn</span>
                      <span className="font-mono opacity-80">{fmt(m.total)}</span>
                      {m.isAnomaly && <AlertTriangle className="h-3 w-3" />}
                    </span>
                  ))}
                </div>



                {myAssignments.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5 border-t pt-2">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground self-center">Assigned triggers:</span>
                    {myAssignments.map((a) => (
                      <span key={a.id} className="inline-flex items-center rounded-md bg-accent/10 text-accent border border-accent/20 px-2 py-0.5 text-xs">
                        <Tag className="h-3 w-3 mr-1" />{labelFor(a.trigger_key, settings, customs)}
                      </span>
                    ))}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function labelFor(key: string, settings: Tables<"trigger_settings">[], customs: Tables<"custom_triggers">[]): string {
  if (key.startsWith("custom-")) {
    const id = key.slice("custom-".length);
    return customs.find((c) => c.id === id)?.label ?? key;
  }
  return settings.find((s) => s.trigger_key === key)?.label ?? key;
}

function FilterChip({
  active, onClick, label, value, icon: Icon, tone, pulse,
}: { active: boolean; onClick: () => void; label: string; value: number; icon: React.ElementType; tone: string; pulse?: boolean }) {
  const colorMap: Record<string, string> = {
    primary: "from-primary to-primary-glow text-primary",
    success: "from-success to-success text-success",
    destructive: "from-destructive to-destructive text-destructive",
    accent: "from-accent to-accent-glow text-accent",
  };
  return (
    <button
      onClick={onClick}
      className={`relative overflow-hidden rounded-lg p-4 text-left transition-all duration-300 border ${
        active ? "ring-2 ring-primary shadow-[var(--shadow-elegant)] -translate-y-0.5" : "hover:-translate-y-0.5 hover:shadow-md"
      } bg-card`}
    >
      <div className={`absolute -right-4 -top-4 h-16 w-16 rounded-full bg-gradient-to-br ${colorMap[tone]} opacity-10`} />
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
          <div className="font-display text-2xl font-bold">{value.toLocaleString()}</div>
        </div>
        <Icon className={`h-5 w-5 ${pulse ? "animate-pulse" : ""} ${colorMap[tone].split(" ").pop()}`} />
      </div>
    </button>
  );
}

function AssignTriggerDialog({
  clientName, settings, customs, assignments, onSave,
}: {
  clientName: string;
  settings: Tables<"trigger_settings">[];
  customs: Tables<"custom_triggers">[];
  assignments: Tables<"watchlist_assignments">[];
  onSave: (args: { clientName: string; triggerKey: string; enabled: boolean; note?: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");

  const isAssigned = (key: string) => assignments.some((a) => a.trigger_key === key && a.enabled);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="mr-1 h-3.5 w-3.5" />Assign trigger</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Assign triggers to {clientName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional analyst note (visible on this assignment)…" rows={2} />
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Built-in</div>
            <div className="space-y-1.5">
              {settings.filter((s) => !(s as Tables<"trigger_settings"> & { is_hidden?: boolean }).is_hidden).map((s) => (
                <div key={s.id} className="flex items-center gap-2 text-sm rounded-md p-2 hover:bg-accent/10 transition-colors">
                  <Switch
                    checked={isAssigned(s.trigger_key)}
                    onCheckedChange={(v) => onSave({ clientName, triggerKey: s.trigger_key, enabled: v, note })}
                  />
                  <span className="flex-1">{s.label}</span>
                </div>
              ))}
            </div>
          </div>
          {customs.length > 0 && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Custom</div>
              <div className="space-y-1.5">
                {customs.map((c) => (
                  <div key={c.id} className="flex items-center gap-2 text-sm rounded-md p-2 hover:bg-accent/10 transition-colors">
                    <Switch
                      checked={isAssigned(`custom-${c.id}`)}
                      onCheckedChange={(v) => onSave({ clientName, triggerKey: `custom-${c.id}`, enabled: v, note })}
                    />
                    <span className="flex-1">{c.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button onClick={() => setOpen(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
