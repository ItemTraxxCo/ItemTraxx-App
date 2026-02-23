const createBarcodeCanvas = (
  value: string,
  JsBarcode: (element: HTMLCanvasElement, text: string, options?: unknown) => void
) => {
  const canvas = document.createElement("canvas");
  JsBarcode(canvas, value, {
    format: "CODE128",
    displayValue: false,
    margin: 2,
    width: 1.2,
    height: 34,
    background: "#ffffff",
    lineColor: "#000000",
  });
  return canvas;
};

export const downloadBarcodePdf = async (barcodes: string[], message: string) => {
  if (!barcodes.length) {
    throw new Error("No barcodes to export.");
  }

  const [{ default: jsPDF }, { default: JsBarcode }] = await Promise.all([
    import("jspdf"),
    import("jsbarcode"),
  ]);

  const pdf = new jsPDF({ unit: "pt", format: "letter" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const marginX = 24;
  const marginY = 26;
  const gutterX = 16;
  const gutterY = 14;
  const columns = 3;
  const labelWidth = (pageWidth - marginX * 2 - gutterX * (columns - 1)) / columns;
  const labelHeight = 96;
  const targetBarcodeWidth = Math.min(126, labelWidth - 18); // ~1.75in sticker barcode width
  const targetBarcodeHeight = 24; // ~0.33in
  let x = marginX;
  let y = marginY;

  for (let index = 0; index < barcodes.length; index += 1) {
    const barcode = barcodes[index];
    if (!barcode) {
      continue;
    }
    if (y + labelHeight > pageHeight - marginY) {
      pdf.addPage();
      x = marginX;
      y = marginY;
    }

    pdf.setDrawColor(208, 214, 224);
    pdf.roundedRect(x, y, labelWidth, labelHeight, 6, 6);

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8.5);
    pdf.text(barcode, x + labelWidth / 2, y + 14, { align: "center" });

    const canvas = createBarcodeCanvas(
      barcode,
      JsBarcode as (element: HTMLCanvasElement, text: string, options?: unknown) => void
    );
    const barcodeWidth = Math.min(targetBarcodeWidth, labelWidth - 14);
    const barcodeHeight = targetBarcodeHeight;
    const barcodeX = x + (labelWidth - barcodeWidth) / 2;
    pdf.addImage(
      canvas.toDataURL("image/png"),
      "PNG",
      barcodeX,
      y + 18,
      barcodeWidth,
      barcodeHeight
    );

    if (message.trim()) {
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(7.5);
      const lines = pdf.splitTextToSize(message.trim(), labelWidth - 12).slice(0, 3);
      pdf.text(lines, x + labelWidth / 2, y + 52, { align: "center" });
    }

    const isLastColumn = (index + 1) % columns === 0;
    if (isLastColumn) {
      x = marginX;
      y += labelHeight + gutterY;
    } else {
      x += labelWidth + gutterX;
    }
  }

  const stamp = new Date().toISOString().slice(0, 10);
  pdf.save(`barcodes-${stamp}.pdf`);
};
