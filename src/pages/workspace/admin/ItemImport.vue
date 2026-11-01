<template>
  <div class="page admin-shell">
    <div class="admin-hero">
      <div class="page-nav-left">
        <RouterLink class="button-link" :to="managerRoot">Back</RouterLink>
      </div>

      <h1>Bulk Item Import Wizard</h1>
      <p v-if="!featureEnabled" class="error">Bulk item import is disabled.</p>
      <p v-else class="admin-hero-copy">Paste CSV rows, preview parsed entries, then import items in one click.</p>
    </div>

    <div v-if="featureEnabled" class="card admin-section-card">
      <div class="admin-section-header">
        <div>
          <h2>Step 1: Paste CSV</h2>
          <p class="admin-section-copy">Format: <code>name,barcode,serial_number,notes</code>. Header row is optional. Newly imported items start as Available.</p>
        </div>
      </div>
      <div class="form-actions import-template-actions">
        <button type="button" @click="downloadTemplate">Download Template CSV</button>
      </div>
      <label>
        Import CSV file
        <input class="ph-no-capture" type="file" accept=".csv,text/csv" @change="handleCsvFileSelect" />
      </label>
      <p class="muted">Selecting a CSV file will auto-fill the text box below.</p>
      <textarea
        v-model="rawInput"
        rows="10"
        placeholder="name,barcode,serial_number,notes&#10;Camera A,ITX-001,SN1001,Main checkout camera"
        @input="invalidatePreview"
      ></textarea>
      <div class="form-actions">
        <button type="button" class="button-primary" @click="parseRows">Parse rows</button>
      </div>
    </div>

    <div class="card admin-section-card" v-if="featureEnabled && parsedRows.length">
      <div class="admin-section-header">
        <div>
          <h2>Step 2: Preview</h2>
          <p class="admin-section-copy">Ready: {{ parsedRows.length }} rows | Skipped in parse: {{ parseSkipped.length }}</p>
        </div>
      </div>
      <div class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Barcode</th>
            <th>Serial</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, index) in parsedRows.slice(0, 200)" :key="`${row.barcode}-${index}`">
            <td>{{ row.name }}</td>
            <td>{{ row.barcode }}</td>
            <td>{{ row.serial_number || "-" }}</td>
            <td data-session-replay-mask>{{ row.notes || "-" }}</td>
          </tr>
        </tbody>
      </table>
      </div>
      <p v-if="parsedRows.length > 200" class="muted">Showing first 200 rows in preview.</p>
      <div class="form-actions">
        <button type="button" class="button-primary" :disabled="isImporting" @click="runImport">
          {{ isImporting ? "Importing..." : "Step 3: Import rows" }}
        </button>
      </div>
    </div>

    <div class="card admin-section-card" v-if="featureEnabled && parseSkipped.length">
      <div class="admin-section-header">
        <div>
          <h2>Parse Skipped Rows</h2>
          <p class="admin-section-copy">Rows missing required data are listed here for review.</p>
        </div>
      </div>
      <ul>
        <li v-for="(item, index) in parseSkipped" :key="`parse-${index}`">
          {{ item.barcode }} — {{ item.reason }}
        </li>
      </ul>
      <div class="form-actions">
        <button type="button" @click="downloadValidationReport('parse')">
          Download Parse Validation Report
        </button>
      </div>
    </div>

    <div class="card admin-section-card" v-if="featureEnabled && importResult">
      <div class="admin-section-header">
        <div>
          <h2>Import Result</h2>
          <p class="admin-section-copy">Review inserted rows and any rows skipped during import.</p>
        </div>
      </div>
      <p>
        Inserted: <strong>{{ importResult.inserted }}</strong>
        | Skipped: <strong>{{ importResult.skipped }}</strong>
      </p>
      <div v-if="importResult.skipped_rows.length">
        <h3>Skipped Rows</h3>
        <ul>
          <li v-for="(item, index) in importResult.skipped_rows" :key="`skip-${index}`">
            {{ item.barcode }} — {{ item.reason }}
          </li>
        </ul>
        <div class="form-actions">
          <button type="button" @click="downloadValidationReport('import')">
            Download Import Validation Report
          </button>
        </div>
      </div>
    </div>

    <p v-if="error" class="error" v-app-toast-error>{{ error }}</p>
    <p v-if="success" class="success" v-app-toast-message="{ kind: success.startsWith('CSV loaded.') ? 'info' : 'success' }">{{ success }}</p>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { bulkImportItem, fetchWorkspaceSettings } from "../../../services/adminOpsService";
import { toUserFacingErrorMessage } from "../../../services/appErrors";
import { capturePostHogEvent } from "../../../services/posthogService";
import { exportRowsToCsv } from "../../../services/exportService";
import { useManagerContext } from "../../../composables/useManagerContext";

const { managerRoot } = useManagerContext();

type ImportRow = {
  name: string;
  barcode: string;
  serial_number?: string;
  status?: string;
  notes?: string;
};

const rawInput = ref("");
const parsedRows = ref<ImportRow[]>([]);
const parseSkipped = ref<Array<{ barcode: string; reason: string }>>([]);
const isImporting = ref(false);
const error = ref("");
const success = ref("");
const featureEnabled = ref(true);
const importResult = ref<{
  inserted: number;
  skipped: number;
  skipped_rows: Array<{ barcode: string; reason: string }>;
} | null>(null);

const invalidatePreview = () => {
  parsedRows.value = [];
  parseSkipped.value = [];
  importResult.value = null;
  error.value = "";
  success.value = "";
};

const downloadTextFile = (filename: string, content: string, contentType: string) => {
  const blob = new Blob([content], { type: contentType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

const downloadTemplate = () => {
  const csv = [
    "name,barcode,serial_number,notes",
    "Camera A,ITX-001,SN1001,Main checkout camera",
    "Tripod B,ITX-002,SN1002,Studio item",
  ].join("\n");
  downloadTextFile("item-import-template.csv", csv, "text/csv;charset=utf-8");
};

const downloadValidationReport = (source: "parse" | "import") => {
  const rows =
    source === "parse"
      ? parseSkipped.value
      : (importResult.value?.skipped_rows ?? []);
  if (!rows.length) {
    error.value = "No validation rows to export.";
    return;
  }
  const filename =
    source === "parse"
      ? `item-import-parse-validation-${new Date().toISOString().slice(0, 10)}.csv`
      : `item-import-validation-${new Date().toISOString().slice(0, 10)}.csv`;
  exportRowsToCsv(filename, ["barcode", "reason"], rows);
};

const parseCsv = (raw: string): { rows: string[][]; error?: string } => {
  const source = raw.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let fields: string[] = [];
  let field = "";
  let inQuotes = false;
  let rowHasContent = false;

  const finishRow = () => {
    fields.push(field.trim());
    if (rowHasContent || fields.some(Boolean)) rows.push(fields);
    fields = [];
    field = "";
    rowHasContent = false;
  };

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (inQuotes) {
      if (char === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && field.trim() === "") {
      field = "";
      inQuotes = true;
      rowHasContent = true;
    } else if (char === ",") {
      fields.push(field.trim());
      field = "";
      rowHasContent = true;
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      finishRow();
    } else {
      field += char;
      if (!/\s/.test(char)) rowHasContent = true;
    }
  }

  if (inQuotes) {
    return { rows: [], error: "CSV contains an unclosed quoted field." };
  }

  if (field.length || fields.length || rowHasContent) finishRow();
  return { rows };
};

const parseRows = () => {
  error.value = "";
  success.value = "";
  importResult.value = null;

  const result = parseCsv(rawInput.value);
  if (result.error) {
    error.value = result.error;
    parsedRows.value = [];
    parseSkipped.value = [];
    return;
  }

  const rows = result.rows.filter((row) => row.some(Boolean));

  if (!rows.length) {
    error.value = "Paste at least one CSV row.";
    parsedRows.value = [];
    parseSkipped.value = [];
    return;
  }

  const parsed: ImportRow[] = [];
  const skipped: Array<{ barcode: string; reason: string }> = [];

  const firstRow = rows[0] ?? [];
  const hasHeader =
    firstRow[0]?.toLowerCase() === "name" && firstRow[1]?.toLowerCase() === "barcode";

  for (const [index, row] of rows.entries()) {
    if (index === 0 && hasHeader) {
      continue;
    }
    const name = row[0]?.trim() ?? "";
    const barcode = row[1]?.trim() ?? "";
    if (!name || !barcode) {
      skipped.push({ barcode: barcode || "(blank)", reason: "Missing name or barcode." });
      continue;
    }
    parsed.push({
      name,
      barcode,
      serial_number: row[2]?.trim() || undefined,
      notes: row.slice(3).join(",").trim() || undefined,
    });
  }

  parsedRows.value = parsed;
  parseSkipped.value = skipped;

  if (!parsed.length) {
    error.value = "No valid rows found after parsing.";
  }
};

const runImport = async () => {
  if (!parsedRows.value.length) {
    error.value = "Parse rows first.";
    return;
  }

  isImporting.value = true;
  error.value = "";
  success.value = "";
  importResult.value = null;

  try {
    const result = await bulkImportItem(parsedRows.value);
    importResult.value = {
      inserted: result.inserted,
      skipped: result.skipped,
      skipped_rows: result.skipped_rows,
    };

    capturePostHogEvent("item_bulk_import_completed", {
      inserted: result.inserted,
      skipped: result.skipped,
    });
    success.value = `Import complete. Added ${result.inserted} items.`;
  } catch (err) {
    error.value = toUserFacingErrorMessage(err, "Unable to import rows.");
  } finally {
    isImporting.value = false;
  }
};

const handleCsvFileSelect = async (event: Event) => {
  const input = event.target as HTMLInputElement | null;
  const file = input?.files?.[0];
  if (!file) {
    return;
  }
  try {
    rawInput.value = await file.text();
    invalidatePreview();
    error.value = "";
    success.value = "CSV loaded. Click \"Parse rows\" to preview.";
  } catch {
    error.value = "Unable to read CSV file.";
  } finally {
    if (input) {
      input.value = "";
    }
  }
};

onMounted(async () => {
  try {
    const settings = await fetchWorkspaceSettings();
    featureEnabled.value = settings.feature_flags.enable_bulk_item_import;
  } catch {
    featureEnabled.value = true;
  }
});
</script>

<style scoped>
.import-template-actions {
  margin-bottom: 0.8rem;
}
</style>
