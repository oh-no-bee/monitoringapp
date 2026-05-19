// Flagged-clients intelligence layer.
// Takes the rules-engine output and produces a smart, AML/FIC-aware narrative
// per high-risk client explaining WHY they were flagged and what to do.

import type { ClientResult } from "@/lib/rules";

export interface FlaggedClient {
  clientName: string;
  clientType: string;
  totalZAR: number;
  txnCount: number;
  riskLevel: ClientResult["riskLevel"];
  riskScore: number; // 0-100
  triggers: ClientResult["triggers"];
  reasons: string[];        // bullet points (plain English, AML/FIC framed)
  narrative: string;        // single-paragraph executive summary
  recommendedAction: string;
}

const fmtZ = (n: number) =>
  "R" + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Map every built-in trigger key to an AML/FIC-framed explanation.
// Custom triggers (key starts with `custom-`) fall back to their label.
function reasonFor(key: string, label: string, c: ClientResult): string {
  switch (key) {
    case "ctr_zar":
      return `Cash Threshold Reporting (CTR) breach — at least one Cash/Local ZAR transaction exceeds the FIC R49 999.99 reporting threshold (FICA Reg 22B). A CTR must be filed with the FIC within 2 business days.`;
    case "structuring":
      return `Structuring detected — daily Cash/Local activity is engineered just below the CTR limit, a hallmark of deliberate avoidance of reporting obligations (FIC Guidance Note 7).`;
    case "smurf_count":
      return `Smurfing pattern — multiple small Cash/Local deposits on the same day suggest funds are being broken up by one or several actors to evade detection.`;
    case "sda_threshold":
      return `Single Discretionary Allowance (SDA) breach — cumulative outbound non-ZAR sells exceed the SARB R1m annual allowance for the client. ${c.sdaNote ? c.sdaNote + "." : ""}`;
    case "iftr":
      return `International Funds Transfer Report (IFTR) trigger — LAC/LAI cross-border transfer above the FIC R19 999.99 reporting threshold.`;
    case "sanction_bypass":
      return `Sanction screening gap — material-value transaction processed without a "Yes" sanction check. This contravenes FIC TFS obligations and must be remediated before settlement.`;
    case "product_migration":
      return `Product risk migration — same deal moved from EFT to Cash/Local at material value, a common layering technique to convert traceable funds into bearer form.`;
    case "layering_products":
      return `Layering — client used multiple distinct products in the period (Cash, EFT, TT, Draft, Local), consistent with the second stage of money-laundering (placement → layering → integration).`;
    case "high_limit_month":
      return `Monthly limit breach — LC/MCPC monthly throughput exceeds the corporate ceiling, requiring source-of-funds re-verification under the RMCP.`;
    case "currency_uturn":
      return `Currency U-turn — client both BUYS and SELLS the same hard currency (USD) in the period, consistent with smurfing or arbitrage to obscure trail.`;
    case "currency_diversity":
      return `Unusual currency mix — client transacted in an abnormally diverse set of currencies for their profile, warranting EDD on commercial rationale.`;
    case "high_velocity":
      return `High velocity — abnormally high deal count for one client in the reporting period; assess for relationship velocity vs. expected behaviour.`;
    case "high_volume_a":
    case "high_volume_b":
      return `High aggregate ZAR volume (${fmtZ(c.totalZAR)}) for the period — exceeds the analyst-defined volume tier and requires source-of-funds review.`;
    default:
      // Custom trigger — use its label verbatim.
      return `Custom rule fired: ${label}.`;
  }
}

function severityWeight(sev: string): number {
  switch (sev) {
    case "Critical": return 35;
    case "High": return 18;
    case "Medium": return 8;
    default: return 3;
  }
}

function recommendedAction(c: ClientResult): string {
  if (c.triggers.some((t) => t.key === "ctr_zar")) {
    return "File CTR with FIC (≤2 business days), perform EDD, request source-of-funds, escalate to MLRO.";
  }
  if (c.triggers.some((t) => t.key === "sanction_bypass")) {
    return "Halt settlement, complete sanction screening, escalate to compliance officer immediately.";
  }
  if (c.triggers.some((t) => t.key === "sda_threshold")) {
    return "Convert to Foreign Investment Allowance (FIA) with SARS tax clearance, refresh KYC.";
  }
  if (c.triggers.some((t) => t.key === "structuring" || t.key === "smurf_count" || t.key === "layering_products")) {
    return "Open STR/SAR investigation file, EDD, review behaviour over last 6 months, consider reporting to FIC.";
  }
  if (c.riskLevel === "Critical" || c.riskLevel === "High") {
    return "Perform Enhanced Due Diligence (EDD), refresh KYC, monitor ongoing.";
  }
  return "Place on heightened monitoring; review again next reporting period.";
}

export function buildFlagged(results: ClientResult[]): FlaggedClient[] {
  return results
    .filter((c) => c.riskLevel === "Critical" || c.riskLevel === "High" || c.triggerCount >= 2)
    .map((c) => {
      const reasons = c.triggers.map((t) => reasonFor(t.key, t.label, c));
      const score = Math.min(
        100,
        c.triggers.reduce((a, t) => a + severityWeight(t.severity), 0) +
          (c.triggerCount >= 4 ? 10 : 0),
      );

      const action = recommendedAction(c);
      const ccyList = c.currencies.filter((x) => x && x !== "ZAR");
      const ccyPhrase = ccyList.length
        ? `in rand plus ${ccyList.slice(0, 3).join(", ")}${ccyList.length > 3 ? " and others" : ""}`
        : "in rand";
      const topReason = reasons[0] ? lower(reasons[0].split(" — ")[0] || reasons[0]) : "unusual activity";
      const extra = reasons.length > 1 ? ` There ${reasons.length === 2 ? "is one more red flag" : `are ${reasons.length - 1} more red flags`} on the file too.` : "";

      const narrative =
        `${c.clientName} (${c.clientType || "unclassified"}) moved ${fmtZ(c.totalZAR)} over ${c.txnCount} transaction${c.txnCount === 1 ? "" : "s"} ${ccyPhrase}. ` +
        `We flagged them because ${topReason}.${extra} ` +
        `Risk score is ${score}/100 — ${c.riskLevel.toLowerCase()} risk. ` +
        `Next step: ${lower(action.replace(/\.$/, ""))}.`;

      return {
        clientName: c.clientName,
        clientType: c.clientType,
        totalZAR: c.totalZAR,
        txnCount: c.txnCount,
        riskLevel: c.riskLevel,
        riskScore: score,
        triggers: c.triggers,
        reasons,
        narrative,
        recommendedAction: action,
      };
    })
    .sort((a, b) => b.riskScore - a.riskScore || b.totalZAR - a.totalZAR);
}

function lower(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}
