import { createServerFn } from "@tanstack/react-start";

export interface AIReportPayload {
  generatedFor: string;
  months: {
    label: string;
    clients: number;
    totalZAR: number;
    txns: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    ctr: number;
    sda: number;
    topTriggers: { label: string; count: number }[];
    topClients: { name: string; type: string; typeLabel: string; totalZAR: number; risk: string; triggers: string[] }[];
  }[];
  combined: {
    clients: number;
    totalZAR: number;
    txns: number;
    critical: number;
    high: number;
    ctr: number;
    sda: number;
    topTriggers: { label: string; count: number }[];
    topClients: { name: string; type: string; typeLabel: string; totalZAR: number; risk: string; months: number; triggers: string[] }[];
  };
}

export interface AIReportResult {
  executiveSummary: string;
  monthlyCommentary: { month: string; commentary: string }[];
  riskThemes: { theme: string; detail: string }[];
  clientAssessments: { client: string; risk: string; assessment: string; action: string }[];
  regulatoryObligations: string[];
  recommendations: string[];
  conclusion: string;
}

const SYSTEM = `You are a senior Compliance Investigator writing the monthly ongoing-monitoring
case file for a South African Authorised Dealer in Foreign Exchange with Limited Authority (ADLA).

HOW TO WRITE
Write in plain, flowing English, as if walking a reader through a case scenario: what happened,
who did it, why it matters, and what we must do about it. Full sentences and connected paragraphs.
Never use bullet points, dashes as list markers, markdown, headings inside a field, or emojis.
Keep it simple and readable — a competent non-specialist must understand it. Tell the story of the
month: what the data shows, which clients stood out, how their behaviour developed, and the
consequence for the business.

ABBREVIATIONS
Never leave a code or acronym unexplained, and prefer plain words over codes. Write out client
categories in full using the entity's own name plus a plain description, for example
"Local Individual", "Local Corporate", "Money Changer Personal Individual",
"Money Changer Personal Corporate", "Foreign Individual", "Foreign Corporate",
"Local Authorised Individual", "Local Authorised Corporate". Do not print raw codes such as
LI, MCPI, LC, B21 on their own. Always name the actual client (entity name) when discussing behaviour.
Spell out regulators and reports on first use and link them to their source, for example
"the Financial Intelligence Centre (FIC)", "the Financial Intelligence Centre Act 38 of 2001 (FIC Act)",
"a Cash Threshold Report (CTR) to the Financial Intelligence Centre under section 28 of the FIC Act",
"an International Funds Transfer Report (IFTR) under section 31 of the FIC Act",
"a Suspicious and Unusual Transaction Report (STR) under section 29 of the FIC Act",
"the Single Discretionary Allowance (SDA) of R1 000 000 per calendar year administered by the
South African Reserve Bank (SARB)", "the Foreign Investment Allowance (FIA), which requires a
SARS tax compliance status pin", and "the firm's Risk Management and Compliance Programme (RMCP)".

ACCURACY
Use exact figures from the data with thousands separators, name real clients and real triggers only,
and never invent a client, amount or event that is not in the data provided.`;


const schema = {
  type: "object",
  properties: {
    executiveSummary: { type: "string", description: "3-5 paragraph formal executive summary of the monitoring period(s)." },
    monthlyCommentary: {
      type: "array",
      items: {
        type: "object",
        properties: { month: { type: "string" }, commentary: { type: "string" } },
        required: ["month", "commentary"],
      },
    },
    riskThemes: {
      type: "array",
      items: {
        type: "object",
        properties: { theme: { type: "string" }, detail: { type: "string" } },
        required: ["theme", "detail"],
      },
    },
    clientAssessments: {
      type: "array",
      description: "One entry per high-risk client supplied, most severe first.",
      items: {
        type: "object",
        properties: {
          client: { type: "string" },
          risk: { type: "string" },
          assessment: { type: "string" },
          action: { type: "string" },
        },
        required: ["client", "risk", "assessment", "action"],
      },
    },
    regulatoryObligations: { type: "array", items: { type: "string" } },
    recommendations: { type: "array", items: { type: "string" } },
    conclusion: { type: "string" },
  },
  required: [
    "executiveSummary",
    "monthlyCommentary",
    "riskThemes",
    "clientAssessments",
    "regulatoryObligations",
    "recommendations",
    "conclusion",
  ],
} as const;

export const generateAIReport = createServerFn({ method: "POST" })
  .inputValidator((data: AIReportPayload) => data)
  .handler(async ({ data }): Promise<AIReportResult> => {
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) throw new Error("AI is not configured for this project.");

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content:
              `Write the monthly ongoing-monitoring compliance case file for record keeping. ` +
              `Tell it as a flowing case scenario written by a compliance investigator: start with the ` +
              `overall picture for the period, then walk month by month through what changed, then ` +
              `explain the clients that concern us by name, what their pattern looks like in practice, ` +
              `why it is a risk to the business, and what we are required to do about it under the ` +
              `Financial Intelligence Centre Act 38 of 2001 (FIC Act) and South African Reserve Bank (SARB) ` +
              `Exchange Control rules. Plain flowing sentences only, no bullet points, no raw client-type codes, ` +
              `every abbreviation written out in full on first use.\n\n` +
              `DATA (JSON). The clientTypeLabel field is the full plain-English client category to use:\n${JSON.stringify(data)}`,

          },
        ],
        tools: [
          {
            type: "function",
            function: { name: "compliance_report", description: "The structured compliance report", parameters: schema },
          },
        ],
        tool_choice: { type: "function", function: { name: "compliance_report" } },
      }),
    });

    if (res.status === 429) throw new Error("AI rate limit reached — please try again shortly.");
    if (res.status === 402) throw new Error("AI credits exhausted — please top up your workspace.");
    if (!res.ok) throw new Error(`AI request failed (${res.status}).`);

    const json = await res.json();
    const call = json?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!call) throw new Error("AI returned no report content.");
    return JSON.parse(call) as AIReportResult;
  });
