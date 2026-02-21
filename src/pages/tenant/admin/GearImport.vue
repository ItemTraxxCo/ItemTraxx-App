<template>
  <div class="page">
    <div class="page-nav-left">
      <RouterLink class="button-link" to="/tenant/admin">Return to admin panel</RouterLink>
      <RouterLink class="button-link" to="/tenant/admin/gear">Return to items</RouterLink>
    </div>

    <h1>Bulk Item Import Wizard</h1>
    <p v-if="!featureEnabled" class="error">Bulk item import is disabled for this tenant.</p>
    <p v-else>Paste CSV rows, preview parsed entries, then import items in one action.</p>

    <div v-if="featureEnabled" class="card">
      <h2>Step 1: Paste CSV</h2>
      <p class="muted">Format: <code>name,barcode,serial_number,notes</code>. Header row is optional. Status is set to <code>available</code> automatically.</p>
      <div class="form-actions import-template-actions">
        <button type="button" @click="downloadTemplate">Download Template CSV</button>
      </div>
      <label>
        Import CSV file
        <input type="file" accept=".csv,text/csv" @change="handleCsvFileSelect" />
      </label>
      <p class="muted">Selecting a CSV file will auto-fill the text box below.</p>
      <textarea
        v-model="rawInput"
        rows="10"
        placeholder="name,barcode,serial_number,notes&#10;Camera A,ITX-001,SN1001,Main checkout camera"
      ></textarea>
      <div class="form-actions">
        <button type="button" class="button-primary" @click="parseRows">Parse rows</button>
      </div>
    </div>

    <div class="card" v-if="featureEnabled && parsedRows.length">
      <h2>Step 2: Preview</h2>
      <p class="muted">Ready: {{ parsedRows.length }} rows | Skipped in parse: {{ parseSkipped.length }}</p>
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
            <td>{{ row.notes || "-" }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="parsedRows.length > 200" class="muted">Showing first 200 rows in preview.</p>
      <div class="form-actions">
        <button type="button" class="button-primary" :disabled="isImporting" @click="runImport">
          {{ isImporting ? "Importing..." : "Step 3: Import rows" }}
        </button>
      </div>
    </div>

    <div class="card" v-if="featureEnabled && parseSkipped.length">
      <h2>Parse Skipped Rows</h2>
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

    <div class="card" v-if="featureEnabled && importResult">
      <h2>Import Result</h2>
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

    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="success" class="success">{{ success }}</p>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { bulkImportGear, fetchTenantSettings } from "../../../services/adminOpsService";
import { logAdminAction } from "../../../services/auditLogService";
import { enforceAdminRateLimit } from "../../../services/rateLimitService";

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

const toCsvCell = (value: string) => {
  const escaped = value.replace(/"/g, "\"\"");
  return `"${escaped}"`;
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
  const csvRows = ["barcode,reason"];
  for (const row of rows) {
    csvRows.push(`${toCsvCell(row.barcode)},${toCsvCell(row.reason)}`);
  }
  downloadTextFile(filename, csvRows.join("\n"), "text/csv;charset=utf-8");
};

const parseLine = (line: string) => {
  const parts: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === "," && !inQuotes) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current.trim());

  return {
    name: parts[0] ?? "",
    barcode: parts[1] ?? "",
    serial_number: parts[2] ?? "",
    notes: parts.slice(3).join(",").trim(),
  };
};

const parseRows = () => {
  error.value = "";
  success.value = "";
  importResult.value = null;

  const lines = rawInput.value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    error.value = "Paste at least one CSV row.";
    parsedRows.value = [];
    parseSkipped.value = [];
    return;
  }

  const parsed: ImportRow[] = [];
  const skipped: Array<{ barcode: string; reason: string }> = [];

  const firstRow = parseLine(lines[0] ?? "");
  const hasHeader =
    firstRow.name.toLowerCase() === "name" && firstRow.barcode.toLowerCase() === "barcode";

  for (const [index, line] of lines.entries()) {
    if (index === 0 && hasHeader) {
      continue;
    }
    const row = parseLine(line);
    const name = row.name.trim();
    const barcode = row.barcode.trim();
    if (!name || !barcode) {
      skipped.push({ barcode: barcode || "(blank)", reason: "Missing name or barcode." });
      continue;
    }
    parsed.push({
      name,
      barcode,
      serial_number: row.serial_number?.trim() || undefined,
      notes: row.notes?.trim() || undefined,
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
    await enforceAdminRateLimit();
    const result = await bulkImportGear(parsedRows.value);
    importResult.value = {
      inserted: result.inserted,
      skipped: result.skipped,
      skipped_rows: result.skipped_rows,
    };

    await logAdminAction({
      action_type: "gear_bulk_import",
      entity_type: "gear",
      metadata: {
        inserted: result.inserted,
        skipped: result.skipped,
      },
    });

    success.value = `Import complete. Added ${result.inserted} items.`;
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Unable to import rows.";
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
    const settings = await fetchTenantSettings();
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
