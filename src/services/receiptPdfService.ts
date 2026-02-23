type TransactionReceipt = {
  timestamp: string;
  studentUsername: string;
  studentId: string;
  tenantId: string | null;
  operatorEmail: string;
  checkouts: number;
  returns: number;
  items: Array<{ name: string; barcode: string; action: "checkout" | "return" }>;
};

export const downloadTransactionReceiptPdf = async (receipt: TransactionReceipt) => {
  const [{ default: jsPDF }] = await Promise.all([import("jspdf/dist/jspdf.es.min.js")]);
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 50;
  const left = 50;
  const right = pageWidth - 50;

  const row = (label: string, value: string) => {
    doc.setFont("helvetica", "bold");
    doc.text(label, left, y);
    doc.setFont("helvetica", "normal");
    doc.text(value, left + 120, y);
    y += 18;
  };

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("ItemTraxx Transaction Receipt", left, y);
  y += 26;
  doc.setFontSize(11);
  row("Time", new Date(receipt.timestamp).toLocaleString());
  row("Student", receipt.studentUsername);
  row("Student ID", receipt.studentId);
  row("Operator", receipt.operatorEmail);
  row("Tenant ID", receipt.tenantId ?? "Unknown");
  row("Checkouts", String(receipt.checkouts));
  row("Returns", String(receipt.returns));

  y += 8;
  doc.setFont("helvetica", "bold");
  doc.text("Items", left, y);
  y += 14;

  doc.setFont("helvetica", "normal");
  for (const item of receipt.items) {
    const line = `${item.name} (${item.barcode}) — ${item.action}`;
    const wrapped = doc.splitTextToSize(line, right - left);
    doc.text(wrapped, left, y);
    y += wrapped.length * 14 + 4;
    if (y > 700) {
      doc.addPage();
      y = 50;
    }
  }

  y += 10;
  const footer =
    "Please review this receipt for accuracy. If anything appears incorrect, contact support@itemtraxx.com.";
  doc.setFont("helvetica", "italic");
  doc.setFontSize(10);
  doc.text(doc.splitTextToSize(footer, right - left), left, y);

  doc.save(`transaction-receipt-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.pdf`);
};
