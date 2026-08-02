import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// jsdom does not implement Blob URL creation/navigation; stub both so
// exportRowsToCsv's download flow can run without throwing.
const createObjectURL = vi.fn((_blob: Blob) => "blob:mock-url");
const revokeObjectURL = vi.fn();

// exportRowsToPdf dynamically imports jsPDF and jspdf-autotable. Mock both at
// the module boundary so the test never touches real canvas/PDF rendering.
const jsPdfInstances: Array<{
  setFontSize: ReturnType<typeof vi.fn>;
  text: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  orientation: string;
}> = [];

vi.mock("jspdf/dist/jspdf.es.min.js", () => ({
  default: class MockJsPDF {
    setFontSize = vi.fn();
    text = vi.fn();
    save = vi.fn();
    orientation: string;
    constructor(options: { orientation: string }) {
      this.orientation = options.orientation;
      jsPdfInstances.push(this);
    }
  },
}));

const autoTable = vi.fn();
vi.mock("jspdf-autotable", () => ({
  default: (...args: unknown[]) => autoTable(...args),
}));

import { exportRowsToCsv, exportRowsToPdf } from "./exportService";

beforeEach(() => {
  vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
  autoTable.mockClear();
  jsPdfInstances.length = 0;
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const readBlobText = async (blob: Blob) => blob.text();

describe("exportRowsToCsv", () => {
  it("builds a header row plus one row per data record, joined by the header order", async () => {
    let capturedBlob: Blob | null = null;
    createObjectURL.mockImplementation((blob: Blob) => {
      capturedBlob = blob;
      return "blob:mock-url";
    });

    exportRowsToCsv(
      "items.csv",
      ["name", "barcode"],
      [
        { name: "Drill", barcode: "BC-1" },
        { name: "Hammer", barcode: "BC-2" },
      ]
    );

    expect(capturedBlob).not.toBeNull();
    const text = await readBlobText(capturedBlob!);
    expect(text).toBe("name,barcode\nDrill,BC-1\nHammer,BC-2");
  });

  it("normalizes null/undefined cell values to empty strings", async () => {
    let capturedBlob: Blob | null = null;
    createObjectURL.mockImplementation((blob: Blob) => {
      capturedBlob = blob;
      return "blob:mock-url";
    });

    exportRowsToCsv("items.csv", ["name", "notes"], [{ name: "Drill", notes: null }, { name: "Hammer", notes: undefined }]);

    const text = await readBlobText(capturedBlob!);
    expect(text).toBe("name,notes\nDrill,\nHammer,");
  });

  it("quotes and escapes cells containing commas, quotes, or newlines", async () => {
    let capturedBlob: Blob | null = null;
    createObjectURL.mockImplementation((blob: Blob) => {
      capturedBlob = blob;
      return "blob:mock-url";
    });

    exportRowsToCsv(
      "items.csv",
      ["notes"],
      [{ notes: 'Contains, a comma' }, { notes: 'Has "quotes"' }, { notes: "Multi\nline" }]
    );

    const text = await readBlobText(capturedBlob!);
    const lines = text.split("\n");
    expect(lines[1]).toBe('"Contains, a comma"');
    expect(lines[2]).toBe('"Has ""quotes"""');
    // The embedded newline means this record's cell spans what looks like two lines,
    // but it is one properly quoted CSV field.
    expect(lines.slice(3).join("\n")).toBe('"Multi\nline"');
  });

  it("prefixes formula-injection characters (=, +, -, @) with a leading apostrophe", async () => {
    let capturedBlob: Blob | null = null;
    createObjectURL.mockImplementation((blob: Blob) => {
      capturedBlob = blob;
      return "blob:mock-url";
    });

    exportRowsToCsv(
      "items.csv",
      ["notes"],
      [
        { notes: "=SUM(A1:A2)" },
        { notes: "+1234" },
        { notes: "-1234" },
        { notes: "@mention" },
        { notes: "safe text" },
      ]
    );

    const text = await readBlobText(capturedBlob!);
    const lines = text.split("\n");
    expect(lines[1]).toBe("'=SUM(A1:A2)");
    expect(lines[2]).toBe("'+1234");
    expect(lines[3]).toBe("'-1234");
    expect(lines[4]).toBe("'@mention");
    expect(lines[5]).toBe("safe text");
  });

  it("triggers a download via an anchor click and revokes the object URL afterward", () => {
    exportRowsToCsv("items.csv", ["name"], [{ name: "Drill" }]);

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
  });

  it("creates the blob with a CSV content type", () => {
    let capturedBlob: Blob | null = null;
    createObjectURL.mockImplementation((blob: Blob) => {
      capturedBlob = blob;
      return "blob:mock-url";
    });

    exportRowsToCsv("items.csv", ["name"], [{ name: "Drill" }]);
    expect(capturedBlob!.type).toBe("text/csv;charset=utf-8;");
  });
});

describe("exportRowsToPdf", () => {
  it("creates a landscape document, writes the title, renders the table, and saves the file", async () => {
    await exportRowsToPdf(
      "items.pdf",
      "Item Report",
      ["name", "barcode"],
      [{ name: "Drill", barcode: "BC-1" }, { name: "Hammer", barcode: null }]
    );

    expect(jsPdfInstances).toHaveLength(1);
    const doc = jsPdfInstances[0]!;
    expect(doc.orientation).toBe("landscape");
    expect(doc.setFontSize).toHaveBeenCalledWith(14);
    expect(doc.text).toHaveBeenCalledWith("Item Report", 14, 14);
    expect(doc.save).toHaveBeenCalledWith("items.pdf");

    expect(autoTable).toHaveBeenCalledWith(
      doc,
      expect.objectContaining({
        startY: 20,
        head: [["name", "barcode"]],
        body: [
          ["Drill", "BC-1"],
          ["Hammer", ""],
        ],
        styles: { fontSize: 8 },
        headStyles: { fillColor: [38, 80, 160] },
      })
    );
  });

  it("renders an empty table body when there are no rows", async () => {
    await exportRowsToPdf("empty.pdf", "Empty Report", ["name"], []);

    expect(autoTable).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ body: [] })
    );
  });
});
