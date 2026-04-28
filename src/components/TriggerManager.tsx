import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Trash2, X, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import type { Tables } from "@/integrations/supabase/types";
import { TXN_FIELDS, OPS, FIELD_OPTIONS, NUMERIC_FIELDS } from "@/lib/rules";

interface Cond { field: string; op: string; value: string; combine?: "AND" | "OR" }

export function TriggerManager({ settings, customs }: { settings: Tables<"trigger_settings">[]; customs: Tables<"custom_triggers">[] }) {
  const qc = useQueryClient();

  const updateSetting = useMutation({
    mutationFn: async (s: Partial<Tables<"trigger_settings">> & { id: string }) => {
      const { error } = await supabase.from("trigger_settings").update({ threshold: s.threshold, enabled: s.enabled, updated_at: new Date().toISOString() }).eq("id", s.id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Saved"); qc.invalidateQueries({ queryKey: ["trigger_settings"] }); },
  });

  return (
    <Tabs defaultValue="builtin" className="mt-4">
      <TabsList className="w-full">
        <TabsTrigger value="builtin" className="flex-1">Built-in Rules ({settings.length})</TabsTrigger>
        <TabsTrigger value="custom" className="flex-1">Custom Rules ({customs.length})</TabsTrigger>
      </TabsList>

      <TabsContent value="builtin" className="space-y-2 mt-4">
        {settings.map((s) => (
          <Card key={s.id} className="p-3">
            <div className="flex items-start gap-3">
              <Switch checked={s.enabled} onCheckedChange={(v) => updateSetting.mutate({ id: s.id, enabled: v, threshold: s.threshold })} />
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm">{s.label}</div>
                <div className="text-xs text-muted-foreground">{s.description}</div>
                {s.threshold != null && (
                  <div className="mt-2 flex items-center gap-2">
                    <Label className="text-xs">Threshold</Label>
                    <Input
                      type="number"
                      step="0.01"
                      defaultValue={Number(s.threshold)}
                      className="h-8 w-40"
                      onBlur={(e) => {
                        const v = Number(e.target.value);
                        if (v !== Number(s.threshold)) updateSetting.mutate({ id: s.id, threshold: v, enabled: s.enabled });
                      }}
                    />
                  </div>
                )}
              </div>
            </div>
          </Card>
        ))}
      </TabsContent>

      <TabsContent value="custom" className="mt-4">
        <CustomRuleEditor customs={customs} />
      </TabsContent>
    </Tabs>
  );
}

function CustomRuleEditor({ customs }: { customs: Tables<"custom_triggers">[] }) {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [label, setLabel] = useState("");
  const [desc, setDesc] = useState("");
  const [severity, setSeverity] = useState("Medium");
  const [agg, setAgg] = useState("per_transaction");
  const [conds, setConds] = useState<Cond[]>([{ field: "total", op: ">", value: "", combine: "AND" }]);

  const reset = () => { setLabel(""); setDesc(""); setSeverity("Medium"); setAgg("per_transaction"); setConds([{ field: "total", op: ">", value: "", combine: "AND" }]); setShowForm(false); };

  const create = useMutation({
    mutationFn: async () => {
      if (!label.trim()) throw new Error("Label required");
      const cleaned = conds.filter((c) => c.value !== "");
      if (!cleaned.length) throw new Error("Add at least one condition with a value");
      const { error } = await supabase.from("custom_triggers").insert([{
        label, description: desc, severity, aggregation: agg, conditions: cleaned as never, enabled: true,
      }]);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Custom rule created"); reset(); qc.invalidateQueries({ queryKey: ["custom_triggers"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("custom_triggers").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Removed"); qc.invalidateQueries({ queryKey: ["custom_triggers"] }); },
  });

  const toggle = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const { error } = await supabase.from("custom_triggers").update({ enabled }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["custom_triggers"] }),
  });

  return (
    <div className="space-y-3">
      {!showForm ? (
        <Button onClick={() => setShowForm(true)} className="w-full"><Plus className="mr-2 h-4 w-4" />New Custom Rule</Button>
      ) : (
        <Card className="p-4 space-y-3 border-accent/40">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold">New Custom Rule</h4>
            <Button size="sm" variant="ghost" onClick={reset}><X className="h-4 w-4" /></Button>
          </div>
          <div>
            <Label className="text-xs">Label</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Large USD Cash Buy" />
          </div>
          <div>
            <Label className="text-xs">Description (optional)</Label>
            <Textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Severity</Label>
              <Select value={severity} onValueChange={setSeverity}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["Critical","High","Medium","Low"].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Apply to</Label>
              <Select value={agg} onValueChange={setAgg}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="per_transaction">Each transaction</SelectItem>
                  <SelectItem value="per_client_total">Client total</SelectItem>
                  <SelectItem value="per_client_count">Client txn count</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label className="text-xs">Conditions</Label>
            <div className="space-y-2 mt-1">
              {conds.map((c, i) => (
                <div key={i} className="flex flex-wrap items-center gap-1.5">
                  {i > 0 && (
                    <Select value={c.combine || "AND"} onValueChange={(v) => setConds(conds.map((x, j) => j === i ? { ...x, combine: v as "AND" | "OR" } : x))}>
                      <SelectTrigger className="w-[70px] h-9"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="AND">AND</SelectItem><SelectItem value="OR">OR</SelectItem></SelectContent>
                    </Select>
                  )}
                  <Select value={c.field} onValueChange={(v) => setConds(conds.map((x, j) => j === i ? { ...x, field: v } : x))}>
                    <SelectTrigger className="w-[180px] h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>{TXN_FIELDS.map(f => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}</SelectContent>
                  </Select>
                  <Select value={c.op} onValueChange={(v) => setConds(conds.map((x, j) => j === i ? { ...x, op: v } : x))}>
                    <SelectTrigger className="w-[100px] h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>{OPS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                  </Select>
                  <Input value={c.value} onChange={(e) => setConds(conds.map((x, j) => j === i ? { ...x, value: e.target.value } : x))} placeholder="value" className="h-9 w-32" />
                  {conds.length > 1 && (
                    <Button size="sm" variant="ghost" onClick={() => setConds(conds.filter((_, j) => j !== i))}><X className="h-3 w-3" /></Button>
                  )}
                </div>
              ))}
              <Button size="sm" variant="outline" onClick={() => setConds([...conds, { field: "total", op: ">", value: "", combine: "AND" }])}><Plus className="mr-1 h-3 w-3" />Add condition</Button>
            </div>
          </div>

          <Button onClick={() => create.mutate()} disabled={create.isPending} className="w-full">Save Rule</Button>
        </Card>
      )}

      {customs.map((c) => (
        <Card key={c.id} className="p-3">
          <div className="flex items-start gap-3">
            <Switch checked={c.enabled} onCheckedChange={(v) => toggle.mutate({ id: c.id, enabled: v })} />
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-sm">{c.label} <span className="ml-2 text-xs font-normal text-muted-foreground">({c.severity})</span></div>
              {c.description && <div className="text-xs text-muted-foreground">{c.description}</div>}
              <div className="mt-1 text-xs text-muted-foreground">
                {(c.conditions as unknown as Cond[]).map((x, i) => (
                  <span key={i}>{i > 0 ? ` ${x.combine || "AND"} ` : ""}<code className="text-foreground">{x.field} {x.op} {x.value}</code></span>
                ))}
              </div>
            </div>
            <Button size="sm" variant="ghost" onClick={() => { if (confirm("Delete rule?")) remove.mutate(c.id); }}><Trash2 className="h-4 w-4 text-destructive" /></Button>
          </div>
        </Card>
      ))}
      {!customs.length && !showForm && (
        <p className="text-xs text-center text-muted-foreground py-4">No custom rules yet. Create one to add bespoke screening logic.</p>
      )}
    </div>
  );
}
