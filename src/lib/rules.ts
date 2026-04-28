// Rules engine: takes transactions + trigger settings + custom triggers and returns clients with risk
import type { Tables } from "@/integrations/supabase/types";

export type Txn = Tables<"transactions">;
export type TriggerSetting = Tables<"trigger_settings">;
export type CustomTrigger = Tables<"custom_triggers">;

export interface ClientResult {
  clientName: string;
  clientType: string;
  totalZAR: number;
  txnCount: number;
  dealCodes: string[];
  currencies: string[];
  triggers: { label: string; severity: string; key: string }[];
  hasCTR: boolean;
  hasSDA: boolean;
  sdaNote: string;
  riskLevel: "Critical" | "High" | "Medium" | "Low";
  triggerCount: number;
  txns: Txn[];
}

const num = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);
const str = (v: unknown) => (v == null ? "" : String(v));
const yes = (v: unknown) => str(v).toLowerCase().startsWith("y");

function getSetting(settings: TriggerSetting[], key: string) {
  return settings.find((s) => s.trigger_key === key);
}
function thr(settings: TriggerSetting[], key: string, fallback: number) {
  const s = getSetting(settings, key);
  if (!s || !s.enabled) return null;
  return s.threshold != null ? Number(s.threshold) : fallback;
}

export function runRules(
  txns: Txn[],
  settings: TriggerSetting[],
  customs: CustomTrigger[],
): ClientResult[] {
  // Group by client
  const byClient = new Map<string, Txn[]>();
  for (const t of txns) {
    const k = str(t.client_name) || "(unknown)";
    if (!byClient.has(k)) byClient.set(k, []);
    byClient.get(k)!.push(t);
  }

  const results: ClientResult[] = [];

  for (const [clientName, list] of byClient) {
    const clientType = str(list[0]?.client_type).toUpperCase();
    const triggers = new Map<string, { label: string; severity: string; key: string }>();
    const dealCodes = new Set<string>();
    const currencies = new Set<string>();
    let totalZAR = 0;
    let usdBuy = false, usdSell = false;
    const dailyCash: Record<string, number> = {};
    const monthTotals: Record<string, number> = {};
    let sdaTotal = 0;
    let sdaNote = "";

    for (const t of list) {
      const total = num(t.total);
      const product = str(t.product).toUpperCase();
      const currency = str(t.currency).toUpperCase();
      const direction = str(t.direction).toUpperCase();
      const sc = str(t.sanction_check).toUpperCase();
      const ct = clientType;
      const dateStr = str(t.txn_date);
      const monthStr = dateStr.slice(0, 7);
      const isCashLocal = product === "CASH" || product === "LOCAL";
      const isLIorMCPI = ct === "LI" || ct === "MCPI";
      const isLACorLAI = ct === "LAC" || ct === "LAI";
      const isLCorMCPC = ct === "LC" || ct === "MCPC";

      if (currency === "ZAR") totalZAR += total;
      dealCodes.add(str(t.deal_code));
      currencies.add(currency);
      if (currency === "USD" && direction === "BUY") usdBuy = true;
      if (currency === "USD" && direction === "SELL") usdSell = true;

      // sanction bypass
      const sanctT = thr(settings, "sanction_bypass", 10000);
      if (sanctT != null && total > sanctT && sc === "NO") {
        triggers.set("sanction_bypass", { label: `Sanction Bypass (>${sanctT.toLocaleString()} & No Check)`, severity: "Critical", key: "sanction_bypass" });
      }

      // structuring (cash/local daily)
      if (isCashLocal) {
        dailyCash[dateStr] = (dailyCash[dateStr] || 0) + total;
        const structT = thr(settings, "structuring", 45000);
        if (structT != null && dailyCash[dateStr] >= structT) {
          triggers.set("structuring", { label: `Structuring Risk (Cash/Local ≥ ${structT.toLocaleString()}/day)`, severity: "High", key: "structuring" });
        }
      }

      // CTR ZAR
      const ctrT = thr(settings, "ctr_zar", 49999.99);
      if (ctrT != null && currency === "ZAR" && isCashLocal && isLIorMCPI && total > ctrT) {
        triggers.set("ctr_zar", { label: `CTR Alert (>${ctrT.toLocaleString()} | LI/MCPI | Cash/Local)`, severity: "Critical", key: "ctr_zar" });
      }

      // IFTR
      const iftrT = thr(settings, "iftr", 19999.99);
      if (iftrT != null && total > iftrT && isLACorLAI) {
        triggers.set("iftr", { label: `IFTR Alert (>${iftrT.toLocaleString()} LAC/LAI)`, severity: "High", key: "iftr" });
      }

      // product migration EFT->Cash
      const pmT = thr(settings, "product_migration", 10000);
      if (pmT != null && isCashLocal && total > pmT) {
        const hasEFT = list.some((x) => str(x.product).toUpperCase() === "EFT" && str(x.deal_code) === str(t.deal_code));
        if (hasEFT) triggers.set("product_migration", { label: `Product Risk Migration (EFT → Cash/Local >${pmT.toLocaleString()})`, severity: "High", key: "product_migration" });
      }

      // monthly high-limit
      monthTotals[monthStr] = (monthTotals[monthStr] || 0) + total;
      const hlmT = thr(settings, "high_limit_month", 2000000);
      if (hlmT != null && isLCorMCPC && monthTotals[monthStr] > hlmT) {
        triggers.set("high_limit_month", { label: `High Monthly Limit (>${hlmT.toLocaleString()}/month LC/MCPC)`, severity: "High", key: "high_limit_month" });
      }

      // SDA cumulative for LI/MCPI on outbound non-ZAR
      if (isLIorMCPI && currency !== "ZAR" && direction === "SELL") {
        sdaTotal += total;
      }
    }

    // SDA threshold
    const sdaT = thr(settings, "sda_threshold", 1000000);
    if (sdaT != null && sdaTotal > sdaT) {
      sdaNote = `Cumulative offshore: ${sdaTotal.toLocaleString()} > ${sdaT.toLocaleString()}`;
      triggers.set("sda_threshold", { label: `SDA Threshold Exceeded — ${sdaNote}`, severity: "High", key: "sda_threshold" });
    }

    // velocity
    const vT = thr(settings, "high_velocity", 3);
    if (vT != null && dealCodes.size > vT) triggers.set("high_velocity", { label: `High Velocity (>${vT} Deals)`, severity: "Medium", key: "high_velocity" });

    // U-turn
    if (getSetting(settings, "currency_uturn")?.enabled && usdBuy && usdSell) {
      triggers.set("currency_uturn", { label: "Currency U-Turn (Buy & Sell USD)", severity: "Medium", key: "currency_uturn" });
    }

    // High volume
    const aT = thr(settings, "high_volume_a", 250000);
    const bT = thr(settings, "high_volume_b", 150000);
    if (aT != null && totalZAR > aT) triggers.set("high_volume_a", { label: `High Volume (>${aT.toLocaleString()})`, severity: "High", key: "high_volume_a" });
    else if (bT != null && totalZAR > bT) triggers.set("high_volume_b", { label: `High Volume (>${bT.toLocaleString()})`, severity: "Medium", key: "high_volume_b" });

    // Currency diversity
    const cdT = thr(settings, "currency_diversity", 3);
    if (cdT != null && currencies.size > cdT) triggers.set("currency_diversity", { label: `Currency Diversification (>${cdT})`, severity: "Medium", key: "currency_diversity" });

    // Custom triggers
    for (const ct of customs) {
      if (!ct.enabled) continue;
      const matched = evaluateCustom(ct, list, totalZAR);
      if (matched) triggers.set(`custom-${ct.id}`, { label: ct.label, severity: ct.severity, key: `custom-${ct.id}` });
    }

    const triggerArr = Array.from(triggers.values());
    const hasCTR = triggers.has("ctr_zar");
    const hasSDA = triggers.has("sda_threshold");

    let riskLevel: ClientResult["riskLevel"] = "Low";
    if (triggerArr.some((t) => t.severity === "Critical") || triggerArr.length >= 4) riskLevel = "Critical";
    else if (triggerArr.some((t) => t.severity === "High")) riskLevel = "High";
    else if (triggerArr.length >= 1) riskLevel = "Medium";

    results.push({
      clientName, clientType, totalZAR, txnCount: list.length,
      dealCodes: Array.from(dealCodes), currencies: Array.from(currencies),
      triggers: triggerArr, hasCTR, hasSDA, sdaNote,
      riskLevel, triggerCount: triggerArr.length, txns: list,
    });
  }

  // Sort by risk
  const order = { Critical: 0, High: 1, Medium: 2, Low: 3 };
  results.sort((a, b) => order[a.riskLevel] - order[b.riskLevel] || b.totalZAR - a.totalZAR);
  return results;
}

interface Cond { field: string; op: string; value: string | number; combine?: "AND" | "OR" }

function evaluateCustom(ct: CustomTrigger, txns: Txn[], totalZAR: number): boolean {
  const conds = (ct.conditions as unknown as Cond[]) || [];
  if (!conds.length) return false;

  const checkRow = (row: Record<string, unknown>): boolean => {
    let result = true;
    let combine: "AND" | "OR" = "AND";
    for (let i = 0; i < conds.length; i++) {
      const c = conds[i];
      const fieldVal = row[c.field];
      const got = matchOp(fieldVal, c.op, c.value);
      if (i === 0) result = got;
      else if (combine === "AND") result = result && got;
      else result = result || got;
      combine = c.combine || "AND";
    }
    return result;
  };

  if (ct.aggregation === "per_transaction") return txns.some(checkRow);
  if (ct.aggregation === "per_client_total") {
    return checkRow({ total: totalZAR, txn_count: txns.length });
  }
  if (ct.aggregation === "per_client_count") {
    return checkRow({ txn_count: txns.length });
  }
  return false;
}

function matchOp(field: unknown, op: string, value: string | number): boolean {
  const n = Number(field);
  const s = String(field ?? "").toLowerCase().trim();
  const vs = String(value ?? "").toLowerCase().trim();
  const vn = Number(value);
  // Support comma-separated values for categorical operators (e.g. "LI,MCPI")
  const list = vs.split(",").map((x) => x.trim()).filter(Boolean);
  switch (op) {
    case ">": return n > vn;
    case ">=": return n >= vn;
    case "<": return n < vn;
    case "<=": return n <= vn;
    case "=": return list.length > 1 ? list.includes(s) : s === vs;
    case "!=": return list.length > 1 ? !list.includes(s) : s !== vs;
    case "contains": return list.length > 1 ? list.some((v) => s.includes(v)) : s.includes(vs);
    case "starts_with": return list.length > 1 ? list.some((v) => s.startsWith(v)) : s.startsWith(vs);
  }
  return false;
}

export const TXN_FIELDS = [
  { value: "total", label: "Total Amount" },
  { value: "currency", label: "Currency" },
  { value: "product", label: "Product" },
  { value: "direction", label: "Direction" },
  { value: "client_type", label: "Client Type" },
  { value: "teller", label: "Teller" },
  { value: "sanction_check", label: "Sanction Check" },
  { value: "sanction_match", label: "Sanction Match" },
  { value: "sanction_hits", label: "Sanction Hits" },
  { value: "txn_count", label: "Transaction Count (per client)" },
];
export const OPS = [
  { value: ">", label: ">" }, { value: ">=", label: "≥" },
  { value: "<", label: "<" }, { value: "<=", label: "≤" },
  { value: "=", label: "equals" }, { value: "!=", label: "≠" },
  { value: "contains", label: "contains" }, { value: "starts_with", label: "starts with" },
];
