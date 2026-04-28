import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { runRules } from "@/lib/rules";
import { Card } from "@/components/ui/card";
import type { Tables } from "@/integrations/supabase/types";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid } from "recharts";
import { Loader2 } from "lucide-react";

type Period = Tables<"upload_periods">;
type Txn = Tables<"transactions">;
type Setting = Tables<"trigger_settings">;
type Custom = Tables<"custom_triggers">;

const RISK_COLORS = {
  Critical: "var(--destructive)",
  High: "var(--accent)",
  Medium: "var(--warning)",
  Low: "var(--success)",
};

export function RiskTrendChart({
  periods,
  settings,
  customs,
}: {
  periods: Period[];
  settings: Setting[];
  customs: Custom[];
}) {
  const ids = periods.map((p) => p.id).sort().join(",");

  const { data: allTxns = [], isFetching } = useQuery({
    queryKey: ["all-txns", ids],
    enabled: periods.length > 0,
    queryFn: async () => {
      const all: Txn[] = [];
      let from = 0;
      const step = 1000;
      while (true) {
        const { data, error } = await supabase
          .from("transactions")
          .select("*")
          .in("period_id", periods.map((p) => p.id))
          .range(from, from + step - 1);
        if (error) throw error;
        if (!data?.length) break;
        all.push(...(data as Txn[]));
        if (data.length < step) break;
        from += step;
      }
      return all;
    },
  });

  if (!periods.length) return null;

  // Build per-period risk counts
  const sorted = [...periods].sort((a, b) =>
    a.year !== b.year ? a.year - b.year : a.month - b.month,
  );
  const data = sorted.map((p) => {
    const ptxns = allTxns.filter((t) => t.period_id === p.id);
    const results = ptxns.length ? runRules(ptxns, settings, customs) : [];
    const counts = { Critical: 0, High: 0, Medium: 0, Low: 0 };
    for (const r of results) counts[r.riskLevel]++;
    return { period: p.period_label, ...counts };
  });

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="font-display text-lg font-semibold">Risk Levels per Month</h3>
          <p className="text-xs text-muted-foreground">Client risk distribution across reporting periods</p>
        </div>
        {isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>
      <div className="h-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey="period" tick={{ fontSize: 12 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
            <Tooltip
              contentStyle={{
                background: "var(--popover)",
                color: "var(--popover-foreground)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                fontSize: 12,
              }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="Critical" stackId="r" fill={RISK_COLORS.Critical} />
            <Bar dataKey="High" stackId="r" fill={RISK_COLORS.High} />
            <Bar dataKey="Medium" stackId="r" fill={RISK_COLORS.Medium} />
            <Bar dataKey="Low" stackId="r" fill={RISK_COLORS.Low} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
