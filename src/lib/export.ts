import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { ClientResult } from "./rules";

export function exportExcel(results: ClientResult[], periodLabel: string) {
  const rows = results.map((c) => ({
    "Client Name": c.clientName,
    "Client Type": c.clientType,
    "Risk Level": c.riskLevel,
    "Total (ZAR)": c.totalZAR,
    "Transactions": c.txnCount,
    "Deal Codes": c.dealCodes.length,
    "Currencies": c.currencies.join(", "),
    "CTR Alert": c.hasCTR ? "YES" : "",
    "SDA Alert": c.hasSDA ? `YES — ${c.sdaNote}` : "",
    "Triggers Hit": c.triggers.map((t) => t.label).join(" | "),
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Compliance Report");
  XLSX.writeFile(wb, `GFX_Compliance_${periodLabel.replace(/\s+/g, "_")}.xlsx`);
}

export function exportPDF(results: ClientResult[], periodLabel: string) {
  const doc = new jsPDF({ orientation: "landscape" });
  doc.setFontSize(16);
  doc.setTextColor(30, 82, 160);
  doc.text("Global Foreign Exchange — Ongoing Monitoring", 14, 15);
  doc.setFontSize(11);
  doc.setTextColor(80);
  doc.text(`Period: ${periodLabel}    Generated: ${new Date().toLocaleString()}`, 14, 22);

  const counts = results.reduce(
    (a, c) => { a[c.riskLevel]++; return a; },
    { Critical: 0, High: 0, Medium: 0, Low: 0 } as Record<string, number>
  );
  doc.setFontSize(10);
  doc.text(`Critical: ${counts.Critical}   High: ${counts.High}   Medium: ${counts.Medium}   Low: ${counts.Low}`, 14, 28);

  autoTable(doc, {
    startY: 33,
    head: [["Client", "Type", "Risk", "Total (ZAR)", "Txns", "Alerts", "Triggers Hit"]],
    body: results.filter(r => r.triggerCount > 0).map((c) => [
      c.clientName, c.clientType, c.riskLevel,
      c.totalZAR.toLocaleString(undefined, { minimumFractionDigits: 2 }),
      c.txnCount,
      [c.hasCTR ? "CTR" : "", c.hasSDA ? "SDA" : ""].filter(Boolean).join(" + "),
      c.triggers.map((t) => t.label).join("; "),
    ]),
    headStyles: { fillColor: [30, 82, 160] },
    styles: { fontSize: 8, cellPadding: 2 },
    columnStyles: { 6: { cellWidth: 100 } },
  });

  doc.save(`GFX_Compliance_${periodLabel.replace(/\s+/g, "_")}.pdf`);
}
