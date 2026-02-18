import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

type ExportRow = Record<string, string | number | null | undefined>;

const escapeCsvCell = (value: string) => {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
};

const normalizeValue = (value: string | number | null | undefined) =>
  value === null || value === undefined ? "" : String(value);

export const exportRowsToCsv = (
  filename: string,
  headers: string[],
  rows: ExportRow[]
) => {
  const csvLines = [
    headers.map(escapeCsvCell).join(","),
    ...rows.map((row) =>
      headers
        .map((header) => escapeCsvCell(normalizeValue(row[header])))
        .join(",")
    ),
  ];

  const blob = new Blob([csvLines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
};

export const exportRowsToPdf = (
  filename: string,
  title: string,
  headers: string[],
  rows: ExportRow[]
) => {
  const doc = new jsPDF({ orientation: "landscape" });
  doc.setFontSize(14);
  doc.text(title, 14, 14);

  autoTable(doc, {
    startY: 20,
    head: [headers],
    body: rows.map((row) => headers.map((header) => normalizeValue(row[header]))),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [38, 80, 160] },
  });

  doc.save(filename);
};
