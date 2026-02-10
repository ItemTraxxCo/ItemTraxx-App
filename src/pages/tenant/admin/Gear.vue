<template>
  <div class="page">
    <h1>Gear Management</h1>
    <p>Add and manage gear.</p>
    <p3> Ability to export gear data to PDF and CSV coming soon.</p3>

    <div class="card">
      <h2>Add Gear</h2>
      <form class="form" @submit.prevent="handleCreate">
        <label>
          Name
          <input v-model="name" type="text" placeholder="Gear name" />
        </label>
        <label>
          Barcode
          <input v-model="barcode" type="text" placeholder="Barcode" />
        </label>
        <label>
          Serial number
          <input v-model="serialNumber" type="text" placeholder="Serial number" />
        </label>
        <label>
          Notes
          <textarea v-model="notes" rows="3" placeholder="Optional notes"></textarea>
        </label>
        <button type="submit" class="button-primary" :disabled="isSaving">Add gear</button>
      </form>
      <p v-if="error" class="error">{{ error }}</p>
      <p v-if="success" class="success">{{ success }}</p>
    </div>

    <div class="card">
      <h2>Gear List</h2>
      <p v-if="isLoading" class="muted">Loading gear...</p>
      <table v-else class="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Barcode</th>
            <th>Serial</th>
            <th>Status</th>
            <th>Notes</th>
            <th></th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in gear" :key="item.id">
            <td>
              <span v-if="editingId !== item.id">{{ item.name }}</span>
              <input
                v-else
                v-model="editName"
                type="text"
                placeholder="Name"
              />
            </td>
            <td>
              <span v-if="editingId !== item.id">{{ item.barcode }}</span>
              <input
                v-else
                v-model="editBarcode"
                type="text"
                placeholder="Barcode"
              />
            </td>
            <td>
              <span
                class="serial-number"
                :class="{ dim: editingId === item.id }"
                title="To edit the serial number, contact support@itemtraxx.com."
              >
                {{ item.serial_number || "-" }}
              </span>
            </td>
            <td>
              <span v-if="editingId !== item.id">{{ item.status }}</span>
              <select v-else v-model="editStatus">
                <option v-for="option in statusOptions" :key="option" :value="option">
                  {{ option }}
                </option>
              </select>
            </td>
            <td>
              <span v-if="editingId !== item.id">{{ item.notes || "-" }}</span>
              <input
                v-else
                v-model="editNotes"
                type="text"
                placeholder="Notes"
              />
            </td>
            <td>
              <div class="admin-actions">
                <button
                  v-if="editingId !== item.id"
                  type="button"
                  class="link"
                  @click="startEdit(item)"
                >
                  Edit
                </button>
                <div v-else class="admin-actions">
                  <button type="button" class="link" @click="saveEdit(item.id)">
                    Save
                  </button>
                  <button type="button" class="link" @click="cancelEdit">
                    Cancel
                  </button>
                  <button
                    type="button"
                    class="link"
                    @click="removeGear(item)"
                  >
                    Remove
                  </button>
                </div>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="admin-actions">
      <RouterLink class="link" to="/tenant/admin">Back to admin panel home</RouterLink>
      <RouterLink class="link" to="/tenant/checkout">Return to checkout</RouterLink>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { getAuthState } from "../../../store/authState";
import { logAdminAction } from "../../../services/auditLogService";
import { enforceAdminRateLimit } from "../../../services/rateLimitService";
import { createGear, deleteGear, fetchGear, updateGear, type GearItem } from "../../../services/gearService";
import { sanitizeInput } from "../../../utils/inputSanitizer";

const gear = ref<GearItem[]>([]);
const isLoading = ref(false);
const isSaving = ref(false);
const error = ref("");
const success = ref("");

const name = ref("");
const barcode = ref("");
const serialNumber = ref("");
const notes = ref("");
const statusOptions = [
  "available",
  "checked_out",
  "damaged",
  "lost",
  "retired",
  "in_studio_only",
];
const editingId = ref<string | null>(null);
const editName = ref("");
const editBarcode = ref("");
const editStatus = ref(statusOptions[0]);
const editNotes = ref("");

const loadGear = async () => {
  isLoading.value = true;
  error.value = "";
  try {
    gear.value = await fetchGear();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Unable to load gear.";
  } finally {
    isLoading.value = false;
  }
};

const handleCreate = async () => {
  error.value = "";
  success.value = "";
  const nameSanitized = sanitizeInput(name.value, { maxLen: 120 });
  const barcodeSanitized = sanitizeInput(barcode.value, { maxLen: 64 });
  const serialSanitized = sanitizeInput(serialNumber.value, { maxLen: 64 });
  const notesSanitized = sanitizeInput(notes.value, { maxLen: 500 });

  name.value = nameSanitized.value;
  barcode.value = barcodeSanitized.value;
  serialNumber.value = serialSanitized.value;
  notes.value = notesSanitized.value;

  const inputError =
    nameSanitized.error ||
    barcodeSanitized.error ||
    serialSanitized.error ||
    notesSanitized.error;

  if (inputError) {
    error.value = inputError;
    return;
  }
  if (!name.value.trim() || !barcode.value.trim()) {
    error.value = "Name and barcode are required.";
    return;
  }

  const auth = getAuthState();
  if (!auth.tenantContextId) {
    error.value = "Missing tenant context.";
    return;
  }

  isSaving.value = true;
  try {
    await enforceAdminRateLimit();
    const created = await createGear({
      tenant_id: auth.tenantContextId,
      name: name.value.trim(),
      barcode: barcode.value.trim(),
      serial_number: serialNumber.value.trim(),
      status: "available",
      notes: notes.value.trim(),
    });
    await logAdminAction({
      action_type: "gear_create",
      entity_type: "gear",
      entity_id: created.id,
      metadata: { name: created.name, barcode: created.barcode },
    });
    gear.value = [created, ...gear.value];
    name.value = "";
    barcode.value = "";
    serialNumber.value = "";
    notes.value = "";
    success.value = "Gear added.";
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Unable to create gear.";
  } finally {
    isSaving.value = false;
  }
};

const startEdit = (item: GearItem) => {
  editingId.value = item.id;
  editName.value = item.name;
  editBarcode.value = item.barcode;
  editStatus.value = item.status;
  editNotes.value = item.notes ?? "";
};

const cancelEdit = () => {
  editingId.value = null;
  editName.value = "";
  editBarcode.value = "";
  editStatus.value = statusOptions[0];
  editNotes.value = "";
};

const saveEdit = async (id: string) => {
  error.value = "";
  success.value = "";
  const nameSanitized = sanitizeInput(editName.value, { maxLen: 120 });
  const barcodeSanitized = sanitizeInput(editBarcode.value, { maxLen: 64 });
  const notesSanitized = sanitizeInput(editNotes.value, { maxLen: 500 });

  editName.value = nameSanitized.value;
  editBarcode.value = barcodeSanitized.value;
  editNotes.value = notesSanitized.value;

  const inputError =
    nameSanitized.error || barcodeSanitized.error || notesSanitized.error;

  if (inputError) {
    error.value = inputError;
    return;
  }
  if (!editName.value.trim() || !editBarcode.value.trim()) {
    error.value = "Name and barcode are required.";
    return;
  }
  isSaving.value = true;
  try {
    await enforceAdminRateLimit();
    const updated = await updateGear({
      id,
      name: editName.value.trim(),
      barcode: editBarcode.value.trim(),
      status: editStatus.value,
      notes: editNotes.value.trim(),
    });
    await logAdminAction({
      action_type: "gear_update",
      entity_type: "gear",
      entity_id: updated.id,
      metadata: { name: updated.name, barcode: updated.barcode },
    });
    gear.value = gear.value.map((item) => (item.id === id ? updated : item));
    success.value = "Gear updated.";
    cancelEdit();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Unable to update gear.";
  } finally {
    isSaving.value = false;
  }
};

const removeGear = async (item: GearItem) => {
  const confirmed = window.confirm(
    `Remove gear "${item.name}"? This cannot be undone.`
  );
  if (!confirmed) return;
  error.value = "";
  success.value = "";
  isSaving.value = true;
  try {
    await enforceAdminRateLimit();
    await deleteGear(item.id);
    await logAdminAction({
      action_type: "gear_remove",
      entity_type: "gear",
      entity_id: item.id,
      metadata: { name: item.name, barcode: item.barcode },
    });
    gear.value = gear.value.filter((row) => row.id !== item.id);
    success.value = "Gear removed.";
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Unable to remove gear.";
  } finally {
    isSaving.value = false;
  }
};

onMounted(loadGear);
</script>
