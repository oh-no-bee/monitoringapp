import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ShieldAlert, AlertTriangle, Settings, FileDown } from "lucide-react";
import type { ClientResult } from "@/lib/rules";
import { buildFlagged } from "@/lib/flagged";

const riskColors: Record<string, string> = {
  Critical: "bg-destructive text-destructive-foreground",
  High: "bg-accent text-accent-foreground",
  Medium: "bg-warning text-warning-foreground",
  Low: "bg-success text-success-foreground",
};
const fmt = (n: number) =>
  "R" + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function FlaggedClients({
  results,
  periodLabel,
  onOpenTriggers,
}: {
  results: ClientResult[];
  periodLabel: string;
  onOpenTriggers: () => void;
}) {
  const [search, setSearch] = useState("");
  const flagged = buildFlagged(results);
  const filtered = flagged.filter((c) =>
    !search || c.clientName.toLowerCase().includes(search.toLowerCase()),
  );

  const exportCsv = () => {
    const rows = [
      ["Client", "Type", "Risk", "Score", "Total ZAR", "Txns", "Triggers", "Narrative", "Recommended Action"],
      ...filtered.map((c) => [
        c.clientName, c.clientType, c.riskLevel, String(c.riskScore),
        c.totalZAR.toFixed(2), String(c.txnCount),
        c.triggers.map((t) => t.label).join(" | "),
        c.narrative, c.recommendedAction,
      ]),
    ];
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `flagged-clients-${periodLabel}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-destructive" />
            <div>
              <div className="font-display text-lg font-bold leading-tight">
                Flagged High-Risk Clients
              </div>
              <div className="text-xs text-muted-foreground">
                AML / FIC ongoing-monitoring · {flagged.length} client{flagged.length === 1 ? "" : "s"} requiring action
              </div>
            </div>
          </div>
          <div className="flex-1" />
          <Input
            placeholder="Search client…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs"
          />
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!filtered.length}>
            <FileDown className="mr-2 h-4 w-4" /> Export CSV
          </Button>
          <Button variant="default" size="sm" onClick={onOpenTriggers}>
            <Settings className="mr-2 h-4 w-4" /> Edit Rules
          </Button>
        </div>
      </Card>

      {filtered.length === 0 ? (
        <Card className="p-12 text-center">
          <ShieldAlert className="mx-auto h-10 w-10 text-success mb-2" />
          <div className="font-display text-xl">No high-risk clients in this period</div>
          <p className="text-sm text-muted-foreground mt-1">
            All clients are within the configured AML/FIC thresholds. Adjust rule sensitivity in the Triggers panel if needed.
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((c, idx) => (
            <Card
              key={c.clientName}
              className="relative overflow-hidden p-5 border-l-4 animate-fade-in transition-all duration-300 hover-lift"
              style={{
                borderLeftColor: c.riskLevel === "Critical" ? "hsl(var(--destructive))" : "hsl(var(--accent))",
                animationDelay: `${Math.min(idx * 40, 400)}ms`,
              }}
            >
              {c.riskLevel === "Critical" && (
                <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-destructive to-transparent animate-shimmer" />
              )}
                borderLeftColor: c.riskLevel === "Critical" ? "hsl(var(--destructive))" : "hsl(var(--accent))",
                animationDelay: `${Math.min(idx * 40, 400)}ms`,
              }}
            >
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-display text-xl font-bold">{c.clientName}</h3>
                    <Badge className={`${riskColors[c.riskLevel]} ${c.riskLevel === "Critical" ? "animate-pulse" : ""}`}>{c.riskLevel}</Badge>
                    <Badge variant="outline" className="font-mono">Score {c.riskScore}/100</Badge>
                    {c.clientType && (
                      <span className="text-xs text-muted-foreground border rounded px-1.5 py-0.5">{c.clientType}</span>
                    )}
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {c.txnCount} transaction{c.txnCount === 1 ? "" : "s"} · Total <span className="font-mono font-semibold text-foreground">{fmt(c.totalZAR)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Triggers Hit</div>
                    <div className="font-display text-3xl font-bold text-accent">{c.triggers.length}</div>
                  </div>
                  <Button size="sm" variant="outline" onClick={onOpenTriggers}>
                    <Settings className="mr-1.5 h-3.5 w-3.5" /> Adjust triggers
                  </Button>
                </div>
              </div>

              <p className="mt-3 text-[15px] leading-relaxed bg-muted/40 rounded-md p-4 border italic">
                <AlertTriangle className="inline h-4 w-4 mr-1 text-accent -mt-0.5" />
                {c.narrative}
              </p>

              <div className="mt-3 flex flex-wrap gap-1.5">
                {c.triggers.map((t) => (
                  <span key={t.key} className="inline-flex items-center rounded-md bg-accent/10 text-accent border border-accent/20 px-2 py-0.5 text-xs font-medium">
                    {t.label}
                  </span>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
