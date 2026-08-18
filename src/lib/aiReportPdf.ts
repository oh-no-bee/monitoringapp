import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { AIReportPayload, AIReportResult } from "./aiReport.functions";

const NAVY: [number, number, number] = [30, 82, 160];
const ORANGE: [number, number, number] = [240, 90, 0];
const fmtZ = (n: number) => "R " + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function exportAIReportPDF(payload: AIReportPayload, report: AIReportResult, scopeLabel: string) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 48;
  let y = 0;

  const footer = () => {
    const pages = doc.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      doc.setDrawColor(...NAVY);
      doc.setLineWidth(0.6);
      doc.line(M, H - 34, W - M, H - 34);
      doc.setFontSize(7.5);
      doc.setTextColor(120);
      doc.text("Global Foreign Exchange — Confidential · AML/CFT Ongoing Monitoring Report", M, H - 22);
      doc.text(`Page ${i} of ${pages}`, W - M, H - 22, { align: "right" });
    }
  };

  const ensure = (need: number) => {
    if (y + need > H - 56) { doc.addPage(); y = M; }
  };

  const sectionTitle = (n: string, t: string) => {
    ensure(46);
    y += 10;
    doc.setFillColor(...NAVY);
    doc.rect(M, y, W - M * 2, 22, "F");
    doc.setFillColor(...ORANGE);
    doc.rect(M, y, 4, 22, "F");
    doc.setTextColor(255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10.5);
    doc.text(`${n}.  ${t.toUpperCase()}`, M + 12, y + 15);
    y += 34;
  };

  const para = (text: string, opts?: { indent?: number; size?: number; bold?: boolean }) => {
    const indent = opts?.indent ?? 0;
    doc.setFont("helvetica", opts?.bold ? "bold" : "normal");
    doc.setFontSize(opts?.size ?? 9.5);
    doc.setTextColor(45);
    const lines = doc.splitTextToSize(text, W - M * 2 - indent) as string[];
    for (const line of lines) {
      ensure(14);
      doc.text(line, M + indent, y);
      y += 13;
    }
    y += 5;
  };

  // ---------- Cover ----------
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, W, 190, "F");
  doc.setFillColor(...ORANGE);
  doc.rect(0, 190, W, 6, "F");
  doc.setTextColor(255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(21);
  doc.text("GLOBAL FOREIGN EXCHANGE", M, 76);
  doc.setFontSize(13);
  doc.setFont("helvetica", "normal");
  doc.text("Ongoing Monitoring — Official AI Compliance Feedback Report", M, 100);
  doc.setFontSize(9.5);
  doc.setTextColor(220, 230, 245);
  doc.text(`Reporting scope: ${scopeLabel}`, M, 128);
  doc.text(`Generated: ${new Date().toLocaleString()}`, M, 144);
  doc.text("Classification: Confidential — Record Keeping (FIC Act s22 / s23)", M, 160);

  y = 232;
  doc.setTextColor(45);

  // Key metrics band
  const c = payload.combined;
  const metrics: [string, string][] = [
    ["Clients screened", String(c.clients)],
    ["Unique deals", String(c.txns)],
    ["Total value", fmtZ(c.totalZAR)],
    ["Critical risk", String(c.critical)],
    ["High risk", String(c.high)],
    ["CTR alerts", String(c.ctr)],
    ["SDA alerts", String(c.sda)],
    ["Months covered", String(payload.months.length)],
  ];
  const cw = (W - M * 2) / 4;
  metrics.forEach((m, i) => {
    const col = i % 4;
    const row = Math.floor(i / 4);
    const x = M + col * cw;
    const yy = y + row * 54;
    doc.setDrawColor(225);
    doc.setFillColor(247, 249, 252);
    doc.rect(x, yy, cw - 8, 46, "FD");
    doc.setFontSize(7.5);
    doc.setTextColor(120);
    doc.text(m[0].toUpperCase(), x + 10, yy + 16);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(m[1].length > 12 ? 10 : 13);
    doc.setTextColor(...NAVY);
    doc.text(m[1], x + 10, yy + 35);
    doc.setFont("helvetica", "normal");
  });
  y += 54 * Math.ceil(metrics.length / 4) + 6;

  // ---------- 1 Executive summary ----------
  sectionTitle(1, "Executive Summary");
  report.executiveSummary.split(/\n{2,}/).forEach((p) => para(p.trim()));

  // ---------- 2 Monthly position ----------
  sectionTitle(2, "Monthly Risk Position");
  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M },
    head: [["Period", "Clients", "Deals", "Total (ZAR)", "Crit", "High", "Med", "Low", "CTR", "SDA"]],
    body: payload.months.map((m) => [
      m.label, m.clients, m.txns,
      m.totalZAR.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      m.critical, m.high, m.medium, m.low, m.ctr, m.sda,
    ]),
    headStyles: { fillColor: NAVY, fontSize: 8 },
    styles: { fontSize: 8, cellPadding: 4 },
    alternateRowStyles: { fillColor: [246, 248, 251] },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 16;

  for (const mc of report.monthlyCommentary) {
    ensure(40);
    para(mc.month, { bold: true, size: 10 });
    para(mc.commentary, { indent: 10 });
  }

  // ---------- 3 Risk themes ----------
  sectionTitle(3, "Key Risk Themes Identified");
  report.riskThemes.forEach((t, i) => {
    ensure(40);
    para(`3.${i + 1}  ${t.theme}`, { bold: true });
    para(t.detail, { indent: 12 });
  });

  // ---------- 4 High-risk clients ----------
  sectionTitle(4, "High-Risk Client Register");
  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M },
    head: [["Client", "Type", "Risk", "Total (ZAR)", "Triggers Breached"]],
    body: c.topClients.map((cl) => [
      cl.name, cl.type, cl.risk,
      cl.totalZAR.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      cl.triggers.join("; "),
    ]),
    headStyles: { fillColor: NAVY, fontSize: 8 },
    styles: { fontSize: 7.5, cellPadding: 4, valign: "top" },
    columnStyles: { 0: { cellWidth: 96 }, 1: { cellWidth: 34 }, 2: { cellWidth: 40 }, 3: { cellWidth: 66 }, 4: { cellWidth: "auto" } },
    alternateRowStyles: { fillColor: [246, 248, 251] },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 18;

  // ---------- 5 Assessments ----------
  sectionTitle(5, "Client-Level Assessment & Disposition");
  report.clientAssessments.forEach((a, i) => {
    ensure(60);
    doc.setFillColor(...ORANGE);
    doc.rect(M, y - 9, 3, 12, "F");
    para(`5.${i + 1}  ${a.client}  —  ${a.risk} risk`, { bold: true, indent: 10 });
    para(a.assessment, { indent: 14 });
    para(`Required action: ${a.action}`, { indent: 14, bold: true });
  });

  // ---------- 6 Obligations ----------
  sectionTitle(6, "Regulatory Reporting Obligations Arising");
  report.regulatoryObligations.forEach((o, i) => para(`${i + 1}.  ${o}`, { indent: 8 }));

  // ---------- 7 Recommendations ----------
  sectionTitle(7, "Recommendations & Control Enhancements");
  report.recommendations.forEach((r, i) => para(`${i + 1}.  ${r}`, { indent: 8 }));

  // ---------- 8 Conclusion & sign-off ----------
  sectionTitle(8, "Conclusion and Sign-Off");
  para(report.conclusion);
  ensure(120);
  y += 16;
  const signW = (W - M * 2 - 24) / 2;
  [["Prepared by (Compliance Analyst)", ""], ["Approved by (MLRO)", ""]].forEach((s, i) => {
    const x = M + i * (signW + 24);
    doc.setDrawColor(...NAVY);
    doc.line(x, y + 40, x + signW, y + 40);
    doc.setFontSize(8);
    doc.setTextColor(90);
    doc.text(s[0], x, y + 54);
    doc.text("Date: ______________________", x, y + 74);
  });

  footer();
  doc.save(`GFX_AI_Compliance_Report_${scopeLabel.replace(/\s+/g, "_")}.pdf`);
}
