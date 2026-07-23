// Deduplicate transactions so each Deal Number is counted only once.
// Canonical row per deal = Product=EFT, Currency=ZAR, Direction=Buy.
// Fallback = row with the largest non-zero |total| for that deal.
// Rows without a deal_code are treated as their own unique deal (kept as-is).

type Row = {
  deal_code?: string | null;
  product?: string | null;
  currency?: string | null;
  direction?: string | null;
  total?: number | string | null;
  [k: string]: unknown;
};

const up = (v: unknown) => String(v ?? "").toUpperCase().trim();

export function dedupeByDeal<T extends Row>(rows: T[]): T[] {
  const groups = new Map<string, T[]>();
  const singletons: T[] = [];
  for (const r of rows) {
    const key = String(r.deal_code ?? "").trim();
    if (!key) { singletons.push(r); continue; }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  const out: T[] = [];
  for (const list of groups.values()) {
    const canonical = list.find(
      (r) => up(r.product) === "EFT" && up(r.currency) === "ZAR" && up(r.direction).startsWith("BUY"),
    );
    if (canonical) { out.push(canonical); continue; }
    let best = list[0];
    let bestAbs = Math.abs(Number(best.total) || 0);
    for (const r of list) {
      const v = Math.abs(Number(r.total) || 0);
      if (v > bestAbs) { best = r; bestAbs = v; }
    }
    out.push(best);
  }
  return [...out, ...singletons];
}
