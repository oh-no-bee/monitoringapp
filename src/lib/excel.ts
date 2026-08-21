import * as XLSX from "xlsx";
import type { TablesInsert } from "@/integrations/supabase/types";

export interface ParsedPeriod {
  periodKey: string;
  periodLabel: string;
  year: number;
  month: number;
  rows: Omit<TablesInsert<"transactions">, "period_id">[];
}

export interface ParsedUpload {
  periods: ParsedPeriod[];
  totalRows: number;
  /** Which column the ZAR value was taken from, for user feedback. */
  zarSource: string;
  /** True when no ZAR-equivalent column was found and Total was used as-is. */
  zarFallback: boolean;
}

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function parseDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v === "number") {
    const d = XLSX.SSF.parse_date_code(v);
    if (d) return new Date(d.y, d.m - 1, d.d);
  }
  if (typeof v === "string") {
    const d = new Date(v);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

const norm = (k: string) => k.toLowerCase().replace(/[\s\n]+/g, " ").trim();
const grab = (row: Record<string, unknown>, ...keys: string[]) => {
  const map = new Map<string, unknown>();
  for (const k of Object.keys(row)) map.set(norm(k), row[k]);
  for (const k of keys) {
    const v = map.get(norm(k));
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return null;
};

export async function parseExcel(file: File): Promise<ParsedUpload> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });

  if (!json.length) throw new Error("Spreadsheet is empty.");

  const rows = json
    .map((r) => {
      const d = parseDate(grab(r, "Date", "Txn Date", "Transaction Date"));
      const currency = String(grab(r, "Currency") ?? "").toUpperCase();
      // PRIMARY source of truth for ZAR value: the "Rand Value (ZAR)" column.
      // We deliberately ignore the foreign-currency "Total" column to avoid
      // double-counting / inflated figures.
      const zarEq = Number(
        grab(
          r,
          "Rand Value (ZAR)", "Rand Value", "Rand Value ZAR",
          "Total (ZAR)", "Total ZAR", "ZAR Total", "ZAR Equivalent",
          "ZAR Amount", "Rand Equivalent", "Total Rand",
          "Amount (ZAR)", "Amount ZAR", "ZAR",
        ) ?? 0,
      ) || 0;
      // Only fall back to the generic Total column when no rand column exists
      // AND the row is already booked in ZAR (so units match).
      const totalRaw = Number(grab(r, "Total", "Total ", "Amount") ?? 0) || 0;
      const total = zarEq > 0 ? zarEq : (currency === "ZAR" ? totalRaw : 0);
      return {
        deal_code:      String(grab(r, "Deal code", "Deal Code") ?? ""),
        txn_date:       d ? d.toISOString().slice(0, 10) : null,
        teller:         String(grab(r, "Teller") ?? ""),
        client_type:    String(grab(r, "Client Type") ?? ""),
        client_name:    String(grab(r, "Client Name") ?? ""),
        sanction_check: String(grab(r, "Sanction Check", "Sanction\nCheck") ?? ""),
        sanction_match: String(grab(r, "Sanction Match", "Sanction\nMatch") ?? ""),
        sanction_hits:  String(grab(r, "Sanction Hits") ?? ""),
        product:        String(grab(r, "Product") ?? ""),
        currency,
        direction:      String(grab(r, "Direction") ?? ""),
        total,
      };
    })
    .filter((r) => r.client_name && r.txn_date);

  if (!rows.length) throw new Error("No valid dated rows found in the spreadsheet.");

  // Group rows by their actual transaction month (YYYY-MM)
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = r.txn_date!.slice(0, 7);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }

  const periods: ParsedPeriod[] = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([periodKey, prows]) => {
      const [yStr, mStr] = periodKey.split("-");
      const year = Number(yStr);
      const month = Number(mStr);
      return {
        periodKey, year, month,
        periodLabel: `${MONTHS[month - 1]} ${year}`,
        rows: prows,
      };
    });

  return { periods, totalRows: rows.length };
}
