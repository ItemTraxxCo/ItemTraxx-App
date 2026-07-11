type BarRun = { start: number; width: number };

export type BarcodePattern = { modules: number; bars: BarRun[] };

// Use JsBarcode purely as the (scanner-correct) CODE128 encoder, then read a
// single pixel row to recover the bar pattern. Rendering one module-wide,
// zero-margin barcode makes canvas.width equal the module count, so we can
// draw the bars as crisp vector rectangles in the PDF instead of embedding a
// rasterised PNG.
export const createBarcodePattern = (
  value: string,
  JsBarcode: (element: HTMLCanvasElement, text: string, options?: unknown) => void
): BarcodePattern => {
  const canvas = document.createElement("canvas");
  JsBarcode(canvas, value, {
    format: "CODE128",
    displayValue: false,
    margin: 0,
    width: 1,
    height: 1,
    background: "#ffffff",
    lineColor: "#000000",
  });

  const context = canvas.getContext("2d");
  if (!context || canvas.width === 0 || canvas.height === 0) {
    throw new Error("Unable to render barcode.");
  }

  const row = Math.floor(canvas.height / 2);
  const { data } = context.getImageData(0, row, canvas.width, 1);

  const bars: BarRun[] = [];
  let runStart = -1;
  for (let column = 0; column < canvas.width; column += 1) {
    const offset = column * 4;
    // Treat a pixel as part of a bar when it is dark and opaque.
    const isDark = data[offset + 3] > 0 && data[offset] < 128;
    if (isDark && runStart === -1) {
      runStart = column;
    } else if (!isDark && runStart !== -1) {
      bars.push({ start: runStart, width: column - runStart });
      runStart = -1;
    }
  }
  if (runStart !== -1) {
    bars.push({ start: runStart, width: canvas.width - runStart });
  }

  return { modules: canvas.width, bars };
};

export const downloadBarcodePdf = async (barcodes: string[], message: string) => {
  if (!barcodes.length) {
    throw new Error("No barcodes to export.");
  }

  const [{ default: jsPDF }, { default: JsBarcode }] = await Promise.all([
    import("jspdf/dist/jspdf.es.min.js"),
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

    const pattern = createBarcodePattern(
      barcode,
      JsBarcode as (element: HTMLCanvasElement, text: string, options?: unknown) => void
    );
    const barcodeWidth = Math.min(targetBarcodeWidth, labelWidth - 14);
    const barcodeHeight = targetBarcodeHeight;
    const barcodeX = x + (labelWidth - barcodeWidth) / 2;
    const barcodeY = y + 18;
    const moduleWidth = barcodeWidth / pattern.modules;
    pdf.setFillColor(0, 0, 0);
    for (const bar of pattern.bars) {
      pdf.rect(
        barcodeX + bar.start * moduleWidth,
        barcodeY,
        bar.width * moduleWidth,
        barcodeHeight,
        "F"
      );
    }

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
