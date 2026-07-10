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
      const narrative = buildCynicalStory(c, score, action);

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

// Cynical case-scenario story — dry, skeptical, business-impact framed.
function buildCynicalStory(c: ClientResult, score: number, action: string): string {
  const keys = new Set(c.triggers.map((t) => t.key));
  const amount = fmtZ(c.totalZAR);
  const ccyList = c.currencies.filter((x) => x && x !== "ZAR");
  const ccyPhrase = ccyList.length
    ? `${ccyList.slice(0, 3).join(", ")}${ccyList.length > 3 ? " and a few more" : ""}`
    : "rand only";
  const who = `${c.clientName}${c.clientType ? ` (${c.clientType})` : ""}`;

  let scenario: string;
  let impact: string;
  if (keys.has("ctr_zar")) {
    scenario = `Cash walked in over the R49 999.99 CTR line and nobody blinked. Textbook placement — either the client genuinely doesn't know the rules (unlikely at this ticket size) or they're testing whether we'll actually file. Miss the CTR by two business days and the FIC penalty stack starts at R10m per contravention, with directors personally on the hook under section 68 of the FIC Act.`;
    impact = `The quiet cost: one missed CTR is enough to trigger a full FIC inspection, and inspections don't stop at one file — they audit the last 24 months. That's weeks of compliance staff time, external legal fees north of R500k, and a supervisory rating downgrade our banking partners will read before we do.`;
  } else if (keys.has("structuring") || keys.has("smurf_count")) {
    scenario = `Multiple small cash deposits, all conveniently landing just under the reporting threshold, all on the same day. This isn't coincidence — this is someone who read the FIC guidance and decided to engineer around it. Classic smurfing / structuring; in court this pattern alone establishes intent under POCA s4-6.`;
    impact = `If prosecutors ever tie this money to the predicate offence — narcotics, tender fraud, VAT scams, take your pick — we become the accommodating financial institution in the indictment. Reputation damage is uninsurable and correspondent banks de-risk fast; ask anyone who's tried to reopen a USD nostro after an FIC finding.`;
  } else if (keys.has("sanction_bypass")) {
    scenario = `A material-value transaction slipped through without a clean sanction screen. On paper it's a control failure; in practice we may have just facilitated a payment to a TFS listee. OFAC and UN listings don't care about intent — strict liability applies.`;
    impact = `Best case: fine and remedial order. Worst case: USD clearing gets cut off, and without USD clearing this business doesn't exist. One sanctions hit has ended entire ADLA licences before.`;
  } else if (keys.has("sda_threshold")) {
    scenario = `${who} has pushed cumulative outbound foreign sells past the R1m SARB SDA ceiling without converting to a FIA with SARS tax clearance. That's an exchange-control contravention, not a paperwork nit — SARB FinSurv can reverse transactions and forfeit funds under Reg 22.`;
    impact = `Every rand above SDA we processed without a TCS pin is a rand we may have to refund and explain. Repeat findings put our authorised-dealer status in play. No AD status = no cross-border business.`;
  } else if (keys.has("layering_products") || keys.has("product_migration")) {
    scenario = `Same money, different products — EFT one leg, cash the next, TT the third. That's the layering stage of the laundering cycle in one client file. Whoever is on the other side is deliberately fragmenting the audit trail so no single teller sees the whole picture.`;
    impact = `We're being used as the washing machine. When this becomes an STR that FIC follows up on, the question won't be "did you notice?" — it'll be "you noticed and did what?" The paper trail this dashboard just produced is the exhibit either way.`;
  } else if (keys.has("high_limit_month") || keys.has("high_volume_a") || keys.has("high_volume_b")) {
    scenario = `${amount} through a single client in one reporting month is not organic behaviour for this profile. Either the KYC on file is stale and we don't actually know who we're dealing with, or someone is running third-party funds through this account.`;
    impact = `Stale KYC is the single most common finding in FIC inspections and the easiest to fine. Refresh source-of-funds now, or explain to the MLRO in six weeks why we didn't.`;
  } else if (keys.has("currency_uturn") || keys.has("currency_diversity")) {
    scenario = `Buying and selling the same hard currency in the same window, across an unusually diverse currency mix. Either arbitrage that shouldn't be profitable at our spreads, or a deliberate attempt to muddy the trail. Neither is comfortable.`;
    impact = `If this is a front for someone else's FX exposure, we carry the excon reporting risk, not them. The commercial rationale needs to be on file before next month, not after the auditors ask.`;
  } else if (keys.has("iftr")) {
    scenario = `Cross-border transfer above the R19 999.99 IFTR line. The report is compulsory, the deadline is short, and the client's file gives no obvious commercial reason for the movement.`;
    impact = `Miss the IFTR and the audit trail against our licence starts. Genuinely the easiest report to file and the easiest fine to avoid — which is exactly why regulators lose patience when we miss it.`;
  } else {
    scenario = `Multiple independent rules fired on the same client in the same period. Individually each one is defensible; together they describe a customer we would not have onboarded if this profile had walked in the door today.`;
    impact = `Cumulative-risk findings are how supervisors argue that our RMCP is ineffective in practice. That argument, once it lands in an inspection report, is very expensive to walk back.`;
  }

  const scoreLine = `Composite risk score sits at ${score}/100 (${c.riskLevel.toLowerCase()}), on ${c.txnCount} transaction${c.txnCount === 1 ? "" : "s"} totalling ${amount} in ${ccyPhrase}, with ${c.triggers.length} rule${c.triggers.length === 1 ? "" : "s"} firing.`;
  const closer = `Recommended next step, unless someone wants to explain the alternative to the MLRO: ${lower(action.replace(/\.$/, ""))}.`;

  return `${who}. ${scenario} ${impact} ${scoreLine} ${closer}`;
}

function lower(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}
