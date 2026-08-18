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
    topClients: { name: string; type: string; totalZAR: number; risk: string; triggers: string[] }[];
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
    topClients: { name: string; type: string; totalZAR: number; risk: string; months: number; triggers: string[] }[];
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

const SYSTEM = `You are the Money Laundering Reporting Officer (MLRO) of a South African
Authorised Dealer in Foreign Exchange with Limited Authority. You write formal monthly
ongoing-monitoring compliance feedback reports for record-keeping under the FIC Act 38 of 2001,
the firm's RMCP, and SARB Exchange Control rules (CTR R49 999.99, IFTR R19 999.99,
SDA R1 000 000 per calendar year, FIA with SARS tax clearance).

Write in a formal, factual, audit-ready register. No bullet characters inside a field, no markdown,
no emojis. Reference exact figures (ZAR amounts with thousands separators), client names and trigger
names from the data provided. Never invent clients or numbers that are not in the data.`;

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
              `Produce the official monthly AML/CFT ongoing-monitoring compliance feedback report ` +
              `for record keeping. Cover each month individually and the combined view. ` +
              `Assess every high-risk client listed, naming their triggers, amounts and the required action.\n\n` +
              `DATA (JSON):\n${JSON.stringify(data)}`,
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
