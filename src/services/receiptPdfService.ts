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

const BRAND_LOGO_URL = import.meta.env.VITE_BRAND_LOGO_LIGHT_URL as string | undefined;

const loadReceiptLogo = async (): Promise<{ dataUrl: string; width: number; height: number } | null> => {
  if (!BRAND_LOGO_URL) return null;
  try {
    const response = await fetch(BRAND_LOGO_URL, { mode: "cors" });
    if (!response.ok) return null;
    const blob = await response.blob();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
    const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => reject(new Error("Unable to load receipt logo image."));
      image.src = dataUrl;
    });
    return { dataUrl, ...dimensions };
  } catch {
    return null;
  }
};

export const downloadTransactionReceiptPdf = async (receipt: TransactionReceipt) => {
  const [{ default: jsPDF }, logoAsset] = await Promise.all([
    import("jspdf/dist/jspdf.es.min.js"),
    loadReceiptLogo(),
  ]);
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

  if (logoAsset) {
    const maxLogoWidth = 160;
    const maxLogoHeight = 40;
    const aspectRatio = logoAsset.width / Math.max(logoAsset.height, 1);
    const widthFromHeight = maxLogoHeight * aspectRatio;
    const logoWidth = Math.min(maxLogoWidth, widthFromHeight);
    const logoHeight = logoWidth / Math.max(aspectRatio, 1e-6);
    doc.addImage(logoAsset.dataUrl, "PNG", left, y - 18, logoWidth, logoHeight);
    y += 26;
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("ItemTraxx Transaction Receipt", left, y + (logoAsset ? 12 : 0));
  y += logoAsset ? 38 : 26;
  doc.setFontSize(11);
  row("Time", new Date(receipt.timestamp).toLocaleString());
  row("Borrower", receipt.studentUsername);
  row("Borrower ID", receipt.studentId);
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

  const pageCount = doc.getNumberOfPages();
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    doc.setPage(pageNumber);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(110, 118, 131);
    doc.text("© 2026 ItemTraxx Co", left, 760);
  }
  doc.setTextColor(0, 0, 0);

  doc.save(`transaction-receipt-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.pdf`);
};
