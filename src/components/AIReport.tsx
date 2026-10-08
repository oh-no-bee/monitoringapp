import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { runRules, type ClientResult, type TriggerSetting, type CustomTrigger } from "@/lib/rules";
import { generateAIReport, type AIReportPayload, type AIReportResult, type AIReportOptions } from "@/lib/aiReport.functions";
import { exportAIReportPDF } from "@/lib/aiReportPdf";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { Settings2, Save, Sparkles, Download, Loader2, FileText, ShieldAlert, Scale, ListChecks, Brain } from "lucide-react";

const fmtZ = (n: number) => "R " + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const riskColors: Record<string, string> = {
  Critical: "bg-destructive text-destructive-foreground",
  High: "bg-ctr text-white",
  Medium: "bg-sda text-white",
  Low: "bg-muted text-muted-foreground",
};

function summarise(results: ClientResult[]) {
  const triggerCounts = new Map<string, number>();
  for (const r of results) for (const t of r.triggers) triggerCounts.set(t.label, (triggerCounts.get(t.label) || 0) + 1);
  const topTriggers = [...triggerCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([label, count]) => ({ label, count }));
  return {
    clients: results.length,
    totalZAR: results.reduce((a, r) => a + r.totalZAR, 0),
    txns: results.reduce((a, r) => a + r.txnCount, 0),
    critical: results.filter((r) => r.riskLevel === "Critical").length,
    high: results.filter((r) => r.riskLevel === "High").length,
    medium: results.filter((r) => r.riskLevel === "Medium").length,
    low: results.filter((r) => r.riskLevel === "Low").length,
    ctr: results.filter((r) => r.hasCTR).length,
    sda: results.filter((r) => r.hasSDA).length,
    topTriggers,
  };
}

const CLIENT_TYPE_LABELS: Record<string, string> = {
  LI: "Local Individual",
  LC: "Local Corporate",
  LAI: "Local Authorised Individual",
  LAC: "Local Authorised Corporate",
  MCPI: "Money Changer Personal Individual",
  MCPC: "Money Changer Personal Corporate",
  FI: "Foreign Individual",
  FC: "Foreign Corporate",
};
const typeLabel = (t: string) => CLIENT_TYPE_LABELS[(t || "").toUpperCase()] || t || "Unclassified";

type Tune = AIReportOptions & {
  periodIds: string[]; // empty = all
  riskLevels: string[];
  clientTypes: string[]; // empty = all
  triggers: string[]; // empty = all
  maxClients: number;
};
const DEFAULT_TUNE: Tune = {
  style: "case",
  length: "standard",
  sections: { summary: true, monthly: true, themes: true, clients: true, obligations: true, recommendations: true },
  focus: "",
  periodIds: [],
  riskLevels: ["Critical", "High"],
  clientTypes: [],
  triggers: [],
  maxClients: 25,
};
const SECTION_LABELS: Record<keyof Tune["sections"], string> = {
  summary: "Executive summary", monthly: "Monthly commentary", themes: "Risk themes",
  clients: "Client register", obligations: "Regulatory obligations", recommendations: "Recommendations",
};

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs transition-colors ${on ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted"}`}>
      {children}
    </button>
  );
}
const toggle = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

const rank = { Critical: 0, High: 1, Medium: 2, Low: 3 } as const;

export default function AIReport({
  periods,
  settings,
  customs,
}: {
  periods: Tables<"upload_periods">[];
  settings: TriggerSetting[];
  customs: CustomTrigger[];
}) {
  const [report, setReport] = useState<AIReportResult | null>(null);
  const [payload, setPayload] = useState<AIReportPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const run = useServerFn(generateAIReport);
  const [tune, setTune] = useState<Tune>(DEFAULT_TUNE);
  const [showTune, setShowTune] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.from("report_settings").select("config").eq("id", "default").maybeSingle().then(({ data }) => {
      if (data?.config) setTune({ ...DEFAULT_TUNE, ...(data.config as Partial<Tune>), sections: { ...DEFAULT_TUNE.sections, ...((data.config as Partial<Tune>).sections || {}) } });
    });
  }, []);

  const saveTune = async () => {
    setSaving(true);
    const { error } = await supabase.from("report_settings").upsert({ id: "default", config: tune as never, updated_at: new Date().toISOString() });
    setSaving(false);
    if (error) toast.error(error.message); else toast.success("Report preferences saved for all devices.");
  };

  const { data: allTxns = [], isFetching } = useQuery({
    queryKey: ["all-txns-report"],
    queryFn: async () => {
      const all: Tables<"transactions">[] = [];
      let from = 0;
      const step = 1000;
      for (;;) {
        const { data, error } = await supabase.from("transactions").select("*").range(from, from + step - 1);
        if (error) throw error;
        all.push(...(data || []));
        if (!data || data.length < step) break;
        from += step;
      }
      return all;
    },
  });

  const scopedTxns = allTxns.filter(
    (t) => (!tune.periodIds.length || tune.periodIds.includes(t.period_id)) &&
      (!tune.clientTypes.length || tune.clientTypes.includes(String((t as Record<string, unknown>).client_type || "").toUpperCase())),
  );
  const allTypes = [...new Set(allTxns.map((t) => String((t as Record<string, unknown>).client_type || "").toUpperCase()).filter(Boolean))].sort();
  const allTriggerLabels = [
    ...settings.filter((x) => (x as { enabled?: boolean }).enabled !== false).map((x) => (x as { label?: string }).label || ""),
    ...customs.map((x) => (x as { label?: string; name?: string }).label || (x as { name?: string }).name || ""),
  ].filter(Boolean);
  const keepClient = (c: ClientResult) =>
    tune.riskLevels.includes(c.riskLevel) && (!tune.triggers.length || c.triggers.some((t) => tune.triggers.includes(t.label)));
  const tc = (c: ClientResult) => (tune.triggers.length ? c.triggers.filter((t) => tune.triggers.includes(t.label)) : c.triggers);

  const byPeriod = periods
    .filter((p) => !tune.periodIds.length || tune.periodIds.includes(p.id))
    .map((p) => ({ period: p, rows: scopedTxns.filter((t) => t.period_id === p.id) }))
    .filter((x) => x.rows.length > 0)
    .reverse();

  const monthResults = byPeriod.map((x) => ({ label: x.period.period_label, results: runRules(x.rows, settings, customs) }));
  const combinedResults = scopedTxns.length ? runRules(scopedTxns, settings, customs) : [];
  const combinedSummary = summarise(combinedResults);

  const buildPayload = (): AIReportPayload => ({
    generatedFor: new Date().toISOString(),
    months: monthResults.map((m) => {
      const s = summarise(m.results);
      return {
        label: m.label,
        ...s,
        topClients: m.results.filter(keepClient)
          .sort((a, b) => rank[a.riskLevel] - rank[b.riskLevel] || b.totalZAR - a.totalZAR)
          .slice(0, Math.min(15, tune.maxClients))
          .map((c) => ({
            name: c.clientName,
            type: c.clientType,
            typeLabel: typeLabel(c.clientType),
            totalZAR: c.totalZAR,
            risk: c.riskLevel,
            triggers: tc(c).map((t) => t.label),
          })),
      };
    }),
    combined: {
      ...combinedSummary,
      topClients: combinedResults.filter(keepClient)
        .sort((a, b) => rank[a.riskLevel] - rank[b.riskLevel] || b.totalZAR - a.totalZAR)
        .slice(0, tune.maxClients)
        .map((c) => ({
          name: c.clientName,
          type: c.clientType,
          typeLabel: typeLabel(c.clientType),
          totalZAR: c.totalZAR,
          risk: c.riskLevel,
          months: monthResults.filter((m) => m.results.some((r) => r.clientName === c.clientName)).length,
          triggers: tc(c).map((t) => t.label),
        })),
    },
  });

  const generate = async () => {
    if (!combinedResults.length) return toast.error("No transaction data to report on.");
    setBusy(true);
    const p = buildPayload();
    try {
      const { style, length, sections, focus } = tune;
      const res = await run({ data: { payload: p, options: { style, length, sections, focus } } });
      setPayload(p);
      setReport(res);
      toast.success("Official AI compliance report generated.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Report generation failed.");
    } finally {
      setBusy(false);
    }
  };

  const scopeLabel = byPeriod.length
    ? `${byPeriod[0].period.period_label} – ${byPeriod[byPeriod.length - 1].period.period_label} (${byPeriod.length} periods)`
    : "No periods";

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <Card className="relative overflow-hidden p-6 border-primary/20">
          <div className="absolute inset-0 bg-[var(--gradient-brand)] opacity-[0.06]" />
          <div className="relative flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Brain className="h-5 w-5 text-accent" />
                <h2 className="font-display text-2xl">Official AI Compliance Report</h2>
              </div>
              <p className="text-sm text-muted-foreground max-w-2xl">
                AI-generated, audit-ready monthly ongoing-monitoring feedback across every uploaded period —
                risk position, themes, named high-risk clients with their triggers, and required actions.
              </p>
              <p className="text-xs text-muted-foreground">Scope: {scopeLabel}</p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => setShowTune((v) => !v)}>
                <Settings2 className="mr-2 h-4 w-4" /> Fine-tune
              </Button>
              <Button onClick={generate} disabled={busy || isFetching}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                {report ? "Regenerate" : "Generate Report"}
              </Button>
              <Button
                variant="secondary"
                disabled={!report || !payload}
                onClick={() => {
                  if (report && payload) {
                    try {
                      const url = exportAIReportPDF(payload, report, scopeLabel);
                      toast.success("PDF downloaded.", {
                        description: "Not seeing it? Open it in a new tab instead.",
                        action: { label: "Open PDF", onClick: () => window.open(url, "_blank") },
                        duration: 10000,
                      });
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "PDF export failed.");
                    }
                  }
                }}
              >
                <Download className="mr-2 h-4 w-4" /> Download PDF
              </Button>
            </div>
          </div>

          <AnimatePresence>
            {showTune && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
                className="relative mt-5 space-y-4 overflow-hidden rounded-lg border bg-card p-4">
                <TuneRow label="Months to read (none selected = all)">
                  {periods.map((p) => <Chip key={p.id} on={tune.periodIds.includes(p.id)} onClick={() => setTune({ ...tune, periodIds: toggle(tune.periodIds, p.id) })}>{p.period_label}</Chip>)}
                </TuneRow>
                <TuneRow label="Risk levels to include">
                  {["Critical", "High", "Medium", "Low"].map((r) => <Chip key={r} on={tune.riskLevels.includes(r)} onClick={() => setTune({ ...tune, riskLevels: toggle(tune.riskLevels, r) })}>{r}</Chip>)}
                </TuneRow>
                <TuneRow label="Client types (none selected = all)">
                  {allTypes.map((t) => <Chip key={t} on={tune.clientTypes.includes(t)} onClick={() => setTune({ ...tune, clientTypes: toggle(tune.clientTypes, t) })}>{typeLabel(t)}</Chip>)}
                </TuneRow>
                <TuneRow label="Only clients hitting these triggers (none selected = any)">
                  {allTriggerLabels.map((t) => <Chip key={t} on={tune.triggers.includes(t)} onClick={() => setTune({ ...tune, triggers: toggle(tune.triggers, t) })}>{t}</Chip>)}
                </TuneRow>
                <TuneRow label="Sections to show">
                  {(Object.keys(SECTION_LABELS) as (keyof Tune["sections"])[]).map((k) => (
                    <Chip key={k} on={tune.sections[k]} onClick={() => setTune({ ...tune, sections: { ...tune.sections, [k]: !tune.sections[k] } })}>{SECTION_LABELS[k]}</Chip>
                  ))}
                </TuneRow>
                <div className="grid gap-4 md:grid-cols-3">
                  <TuneRow label="Writing style">
                    {([["case", "Case story"], ["formal", "Formal"], ["brief", "Brief"]] as const).map(([v, l]) => <Chip key={v} on={tune.style === v} onClick={() => setTune({ ...tune, style: v })}>{l}</Chip>)}
                  </TuneRow>
                  <TuneRow label="Length">
                    {([["short", "Short"], ["standard", "Standard"], ["detailed", "Detailed"]] as const).map(([v, l]) => <Chip key={v} on={tune.length === v} onClick={() => setTune({ ...tune, length: v })}>{l}</Chip>)}
                  </TuneRow>
                  <TuneRow label={`Max clients in register: ${tune.maxClients}`}>
                    <input type="range" min={5} max={50} step={5} value={tune.maxClients} onChange={(e) => setTune({ ...tune, maxClients: Number(e.target.value) })} className="w-full accent-[var(--primary)]" />
                  </TuneRow>
                </div>
                <TuneRow label="Extra instructions for the AI (optional)">
                  <textarea value={tune.focus} onChange={(e) => setTune({ ...tune, focus: e.target.value })} rows={3}
                    placeholder="e.g. Focus on cash structuring and Reserve Bank allowance breaches; mention repeat offenders across months."
                    className="w-full rounded-md border bg-background p-2 text-sm" />
                </TuneRow>
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => setTune(DEFAULT_TUNE)}>Reset</Button>
                  <Button variant="secondary" onClick={saveTune} disabled={saving}><Save className="mr-2 h-4 w-4" />Save preferences</Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="relative mt-5 grid grid-cols-2 gap-3 md:grid-cols-6">
            {[
              ["Clients", combinedSummary.clients],
              ["Deals", combinedSummary.txns],
              ["Total Value", fmtZ(combinedSummary.totalZAR)],
              ["Critical", combinedSummary.critical],
              ["High", combinedSummary.high],
              ["CTR / SDA", `${combinedSummary.ctr} / ${combinedSummary.sda}`],
            ].map(([label, value], i) => (
              <motion.div
                key={String(label)}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="rounded-lg border bg-card/70 p-3"
              >
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
                <div className="font-display text-lg text-primary">{value}</div>
              </motion.div>
            ))}
          </div>
        </Card>
      </motion.div>

      {busy && (
        <Card className="p-10 text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-accent" />
          <p className="mt-3 text-sm text-muted-foreground">
            The AI MLRO is reviewing {combinedSummary.txns.toLocaleString()} deals across {monthResults.length} periods…
          </p>
        </Card>
      )}

      <AnimatePresence>
        {report && !busy && (
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
            {tune.sections.summary && (
<Section icon={FileText} title="Executive Summary">
              {report.executiveSummary.split(/\n{2,}/).map((p, i) => (
                <p key={i} className="text-sm leading-relaxed text-foreground/90">{p.trim()}</p>
              ))}
            </Section>)}

            {tune.sections.monthly && (
<Section icon={ListChecks} title="Monthly Risk Position">
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-secondary/50 text-left text-xs uppercase tracking-wider">
                    <tr>
                      <th className="px-3 py-2">Period</th><th className="px-3 py-2">Clients</th>
                      <th className="px-3 py-2">Deals</th><th className="px-3 py-2 text-right">Total (ZAR)</th>
                      <th className="px-3 py-2">Crit</th><th className="px-3 py-2">High</th>
                      <th className="px-3 py-2">CTR</th><th className="px-3 py-2">SDA</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payload?.months.map((m) => (
                      <tr key={m.label} className="border-t hover:bg-muted/40">
                        <td className="px-3 py-2 font-medium">{m.label}</td>
                        <td className="px-3 py-2">{m.clients}</td>
                        <td className="px-3 py-2">{m.txns}</td>
                        <td className="px-3 py-2 text-right font-mono">{fmtZ(m.totalZAR)}</td>
                        <td className="px-3 py-2">{m.critical}</td>
                        <td className="px-3 py-2">{m.high}</td>
                        <td className="px-3 py-2">{m.ctr}</td>
                        <td className="px-3 py-2">{m.sda}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="space-y-3 pt-2">
                {report.monthlyCommentary.map((m) => (
                  <div key={m.month} className="rounded-md border-l-4 border-primary/60 bg-muted/30 p-3">
                    <div className="text-xs font-semibold uppercase tracking-wider text-primary">{m.month}</div>
                    <p className="mt-1 text-sm leading-relaxed">{m.commentary}</p>
                  </div>
                ))}
              </div>
            </Section>)}

            {tune.sections.themes && (
<Section icon={Scale} title="Risk Themes Identified">
              <div className="grid gap-3 md:grid-cols-2">
                {report.riskThemes.map((t, i) => (
                  <motion.div key={i} whileHover={{ y: -2 }} className="rounded-lg border bg-card p-4">
                    <div className="font-semibold text-sm text-accent">{t.theme}</div>
                    <p className="mt-1 text-sm text-muted-foreground leading-relaxed">{t.detail}</p>
                  </motion.div>
                ))}
              </div>
            </Section>)}

            {tune.sections.clients && (
<Section icon={ShieldAlert} title="High-Risk Client Register">
              <div className="space-y-3">
                {report.clientAssessments.map((c, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.03 }}
                    whileHover={{ y: -2 }}
                    className="rounded-lg border bg-card p-4 transition-shadow hover:shadow-[var(--shadow-elegant)]"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-semibold">{c.client}</div>
                      <Badge className={riskColors[c.risk] || riskColors.Low}>{c.risk}</Badge>
                    </div>
                    {(() => {
                      const src = payload?.combined.topClients.find((x) => x.name === c.client);
                      if (!src) return null;
                      return (
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-xs text-muted-foreground">{fmtZ(src.totalZAR)}</span>
                          <span className="text-xs text-muted-foreground">· {src.type} · active {src.months} month(s)</span>
                          {src.triggers.map((t) => (
                            <span key={t} className="rounded-md border border-accent/20 bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent">
                              {t}
                            </span>
                          ))}
                        </div>
                      );
                    })()}
                    <Separator className="my-3" />
                    <p className="text-sm leading-relaxed">{c.assessment}</p>
                    <p className="mt-2 text-sm"><span className="font-semibold text-primary">Required action: </span>{c.action}</p>
                  </motion.div>
                ))}
              </div>
            </Section>)}

            <div className="grid gap-6 md:grid-cols-2">
              {tune.sections.obligations && (
<Section icon={Scale} title="Regulatory Obligations">
                <ul className="space-y-2">
                  {report.regulatoryObligations.map((o, i) => (
                    <li key={i} className="flex gap-2 text-sm"><span className="text-accent">▪</span>{o}</li>
                  ))}
                </ul>
              </Section>)}
              {tune.sections.recommendations && (
<Section icon={ListChecks} title="Recommendations">
                <ul className="space-y-2">
                  {report.recommendations.map((o, i) => (
                    <li key={i} className="flex gap-2 text-sm"><span className="text-primary">▪</span>{o}</li>
                  ))}
                </ul>
              </Section>)}
            </div>

            <Section icon={FileText} title="Conclusion & Sign-off">
              <p className="text-sm leading-relaxed">{report.conclusion}</p>
              <div className="mt-6 grid gap-6 md:grid-cols-2 text-xs text-muted-foreground">
                {["Prepared by (Compliance Officer)", "Approved by (MLRO)"].map((r) => (
                  <div key={r}>
                    <div className="h-8 border-b border-foreground/30" />
                    <div className="mt-1">{r} · Date</div>
                  </div>
                ))}
              </div>
            </Section>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-5 space-y-3">
      <div className="flex items-center gap-2 border-b pb-2">
        <Icon className="h-4 w-4 text-accent" />
        <h3 className="font-display text-lg">{title}</h3>
      </div>
      {children}
    </Card>
  );
}

function TuneRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}
