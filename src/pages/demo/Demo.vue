<template>
  <main class="demo">
    <div class="demo-notice"><strong>Interactive demo</strong> · This simulated experience uses sample data and is not connected to your ItemTraxx workspace or live services. <RouterLink to="/">Exit demo</RouterLink></div>
    <div class="demo-layout">
      <section ref="workspaceElement" class="workspace" aria-label="Demo workspace">
        <div class="workspace-body">
          <FreeRoam v-if="freeRoam" />
          <template v-else>
          <div v-if="step < 7" class="page checkout-page">
            <div class="page-header checkout-page-header"><h1 class="checkout-brand-title"><img class="checkout-brand-logo" :src="brandLogoUrl" alt="ItemTraxx" /></h1></div><p class="checkout-page-copy">Checkout and return</p>
            <div class="card checkout-card">
              <label>Borrower ID<div class="input-row checkout-input-row"><input v-model="borrowerInput" placeholder="Enter borrower ID" :readonly="step !== 0 && step !== 3" @keyup.enter="loadBorrower"/><button class="button-primary checkout-inline-button" :disabled="(step !== 0 && step !== 3) || borrowerInput !== 'BR-1001'" @click="loadBorrower">Load borrower</button></div></label>
              <p v-if="!borrowerLoaded" class="muted">Enter a borrower ID to begin.</p>
              <template v-else><div class="checkout-borrower-summary"><p><strong>Alex Morgan</strong> <span class="muted">ID: BR-1001</span></p><p v-if="checkedOut">Currently checked out: Laptop</p><p v-else class="muted">No items currently checked out.</p></div>
                <label>Item barcode<div class="input-row checkout-input-row"><input v-model="barcodeInput" placeholder="Scan or enter barcode" :readonly="step !== 1 && step !== 4" @keyup.enter="addBarcode"/><button class="button-primary checkout-inline-button" :disabled="!(step === 1 || step === 4) || barcodeInput !== 'IT-1001'" @click="addBarcode">Add barcode</button></div></label>
                <p class="muted">Press Enter or click “Add barcode” to add.</p><div v-if="queued"><strong>Items</strong><p>Laptop <span class="muted">(IT-1001)</span> <span class="tag" :class="checkedOut ? 'tag-return' : 'tag-checkout'">{{ checkedOut ? 'Return' : 'Checkout' }}</span></p></div>
                <div class="actions checkout-actions"><button class="button-primary checkout-submit-button" :disabled="isSubmitting || !queued || !(step === 2 || step === 5)" @click="completeTransaction">Complete transaction</button></div>
                <p v-if="step === 4" class="success">Checkout complete.</p><p v-if="step === 6" class="success">Return complete.</p>
              </template>
            </div>
          </div>
          <div v-else-if="step < 13" class="page admin-shell">
            <div class="admin-hero"><h1>Borrower Management</h1><p class="admin-hero-copy">Add borrowers, review details, and manage archived records.</p><div class="admin-summary-grid"><div class="admin-summary-card"><strong>{{ borrowerArchived ? 1 : borrowerCreated ? 2 : 1 }}</strong><span>Active borrowers</span></div><div class="admin-summary-card"><strong>{{ borrowerArchived ? 1 : 0 }}</strong><span>Archived borrowers</span></div></div></div>
            <div class="card admin-section-card"><h2>Add Borrower</h2><p class="muted">Generate a new borrower identity and add it to this tenant.</p><div class="form"><label>Username<input value="silver-otter" readonly /></label><label>Borrower ID<input value="BR-2002" readonly /></label><TenantAccessPicker v-if="step === 7 || step === 8" v-model:access-mode="accessMode" v-model:selected-ids="selectedIds" :accounts="accounts" /><button class="button-primary" :disabled="step !== 9" @click="createBorrower">Add borrower</button></div></div>
            <div class="card admin-section-card"><h2>Borrowers</h2><p class="muted">Search, export, and inspect borrower records from one table.</p><div class="table-wrap"><table class="table"><thead><tr><th>Username</th><th>Borrower ID</th><th>Tenant Accounts</th><th>Details</th></tr></thead><tbody><tr><td>Alex Morgan</td><td>BR-1001</td><td>All</td><td>—</td></tr><tr v-if="borrowerCreated && !borrowerArchived"><td>silver-otter</td><td>BR-2002</td><td>Specific accounts</td><td><button :disabled="step !== 10" @click="step++">Details</button></td></tr></tbody></table></div></div>
            <Teleport to="body">
              <div v-if="step === 11" class="demo-modal-backdrop" :style="overlayBounds">
                <div class="demo-modal" role="dialog" aria-labelledby="demo-borrower-details-title">
                  <h2 id="demo-borrower-details-title">Borrower details</h2>
                  <p class="muted">View username, borrower ID, and checkout history.</p>
                  <h3>silver-otter</h3><p class="muted">Borrower ID: BR-2002</p>
                  <h3>Currently checked out</h3><p class="muted">No items currently checked out.</p>
                  <h3>Last checkout</h3><p class="muted">No checkout history.</p>
                  <h3>Last return</h3><p class="muted">No return history.</p>
                  <div class="admin-actions"><button type="button" @click="archiveBorrower">Archive borrower</button></div>
                </div>
              </div>
            </Teleport>
          </div>
          <div v-else-if="step < 21" class="page admin-shell">
            <div class="admin-hero"><h1>Item Management</h1><p class="admin-hero-copy">Add inventory, update item status, and review archived items without jumping between views.</p><div class="admin-summary-grid"><div class="admin-summary-card"><strong>{{ itemArchived ? 1 : itemCreated ? 2 : 1 }}</strong><span>Active items</span></div><div class="admin-summary-card"><strong>{{ itemArchived ? 1 : 0 }}</strong><span>Archived items</span></div></div></div>
            <div class="card admin-section-card"><h2>Add Item</h2><p class="muted">Create a new inventory record with barcode, serial number, and notes.</p><form class="form" @submit.prevent="createItem"><label>Name<input v-model="itemName" placeholder="Item name" :readonly="step !== 13" /></label><label>Barcode<input v-model="itemBarcode" placeholder="Barcode" :readonly="step !== 14" /></label><label>Serial number<input v-model="itemSerial" placeholder="Serial number" :readonly="step !== 15" /></label><label>Notes<textarea v-model="itemNotes" rows="3" maxlength="500" placeholder="Optional notes" :readonly="step !== 16"></textarea></label><button class="button-primary" :disabled="step !== 17">Add item</button></form></div>
            <div class="card admin-section-card"><h2>Item List</h2><p class="muted">Search and filter items, then export or open item details.</p><div class="table-wrap"><table class="table"><thead><tr><th>Name</th><th>Barcode</th><th>Serial</th><th>Status</th><th>Notes</th><th></th></tr></thead><tbody><tr><td>Laptop</td><td>IT-1001</td><td>—</td><td>Available</td><td>—</td><td>—</td></tr><tr v-if="itemCreated && !itemArchived"><td>{{ savedName }}</td><td>IT-2002</td><td>{{ itemSerial }}</td><td>Available</td><td>{{ itemNotes }}</td><td><button :disabled="step !== 18" @click="step++">Details</button></td></tr></tbody></table></div></div>
            <Teleport to="body">
              <div v-if="step === 19 || step === 20" class="demo-modal-backdrop" :style="overlayBounds">
                <div class="demo-modal" role="dialog" aria-labelledby="demo-item-details-title">
                  <h2 id="demo-item-details-title">Item details</h2>
                  <div class="form-grid-2">
                    <label>Name<input v-model="editName" :readonly="step !== 19 || !editing" /></label>
                    <label>Barcode<input value="IT-2002" readonly /></label>
                    <label>Serial Number<input :value="itemSerial" readonly disabled /></label>
                    <label>Status<input value="Available" readonly /></label>
                  </div>
                  <label>Notes<textarea :value="itemNotes" readonly rows="3"></textarea></label>
                  <div class="admin-actions"><button v-if="step === 19 && !editing" @click="editing = true">Edit item</button><button v-else-if="step === 19" :disabled="editName !== 'Tablet Pro'" @click="saveItem">Save</button><button v-else @click="archiveItem">Archive item</button></div>
                </div>
              </div>
            </Teleport>
          </div>
          <div v-else class="page admin-shell"><div class="admin-hero"><h1>Item Logs</h1><p class="admin-hero-copy">Filter checkout and return activity, then export the current view to PDF and CSV.</p></div><div class="card admin-section-card"><h2>History</h2><p class="muted">Search by action, borrower, item, or date range.</p><div class="table-wrap"><table class="table"><thead><tr><th>Time</th><th>Action</th><th>Tenant Account</th><th>Borrower</th><th>Item</th></tr></thead><tbody><tr v-for="action in ['Checkout', 'Return']" :key="action"><td>Just now</td><td>{{ action }}</td><td>demo@example.com</td><td>Alex Morgan (BR-1001)</td><td>Laptop (IT-1001)</td></tr></tbody></table></div></div></div>
          </template>
        </div>
      </section>
      <aside v-if="freeRoam" class="guide"><h2>Explore on your own</h2><p>Choose a section in the demo workspace to explore sample borrowers, items, transactions, and logs.</p><p>Free roam starts with fresh sample data. Changes are not saved and disappear when you leave free roam or refresh.</p><RouterLink class="guide-next" to="/request-demo">Contact us →</RouterLink><button class="restart" @click="freeRoam = false">Return to completion</button></aside>
      <aside v-else class="guide" aria-live="polite"><div class="progress-label"><span>Step {{ Math.min(step + 1, steps.length) }} of {{ steps.length }}</span><span>{{ Math.round((Math.min(step, steps.length) / steps.length) * 100) }}%</span></div><div class="progress"><span :style="{ width: `${Math.round((Math.min(step, steps.length) / steps.length) * 100)}%` }"></span></div><button v-if="step > 0" type="button" class="guide-back" :disabled="isSubmitting" @click="goBack">← Back</button><template v-if="step < steps.length"><h2>{{ current.title }}</h2><p>{{ current.description }}</p><div v-if="current.value" class="value-box"><span>Enter this value</span><button class="copy-value" @click="copyValue">{{ current.value }} <small>{{ copied ? 'Copied!' : 'Copy' }}</small></button><button class="insert" @click="insertValue">Insert into field</button></div><p v-if="step === 7 || step === 8" class="hint">Use the access controls in the demo workspace.</p><button v-if="step === 6 || step === 12 || step === 21" class="guide-next" @click="step++">{{ step === 21 ? 'Finish demo' : 'Continue' }} →</button></template><template v-else><h2>You completed the demo!</h2><p>Want to see more of ItemTraxx or talk through how it can work for your team?</p><RouterLink class="guide-next" to="/request-demo">Contact us →</RouterLink><button class="guide-next" @click="freeRoam = true">Explore on your own →</button><button class="restart" @click="restart">Restart demo</button></template><p class="guide-footnote">Your progress and sample data are not saved. Refreshing this page starts the tour over. This demo uses sample data.</p></aside>
    </div>
    <div v-if="toastMessage" :key="toastId" class="toast demo-toast" :class="{ 'toast-persist': isSubmitting }" role="status" aria-live="polite" aria-atomic="true">
      <div class="toast-title">{{ toastTitle }}</div>
      <div class="toast-body">{{ toastMessage }}</div>
      <div v-if="toastUndo" class="toast-actions"><button type="button" class="toast-action-button" @click="undoArchive">Undo</button></div>
    </div>
  </main>
</template>
<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import TenantAccessPicker from '../../components/app/TenantAccessPicker.vue';
import FreeRoam from './FreeRoam.vue';
import '../../styles/authenticated.css';
const brandLogoUrl = import.meta.env.VITE_BRAND_LOGO_LIGHT_URL || '/brand/logo-light.png';
const steps = [
 { title: 'Look up a borrower', description: 'Enter the sample borrower ID, then select Load borrower.', value: 'BR-1001' },
 { title: 'Add an item', description: 'Enter the laptop barcode and select Add barcode.', value: 'IT-1001' },
 { title: 'Complete the checkout', description: 'Review the item and select Complete transaction.' },
 { title: 'Look up the borrower again', description: 'Enter the borrower ID again and select Load borrower to start the return.', value: 'BR-1001' },
 { title: 'Start a return', description: 'Enter the same barcode to return the laptop.', value: 'IT-1001' },
 { title: 'Complete the return', description: 'Select Complete transaction to return the item.' },
 { title: 'Transaction complete', description: 'The laptop is available again. Next, let’s manage a borrower.' },
 { title: 'Choose borrower access', description: 'Borrower identities are generated automatically. Select Specific Tenant Accounts to limit who can access this borrower.' },
 { title: 'Select an account', description: 'Choose staff@example.com for this borrower.' },
 { title: 'Add the borrower', description: 'Select Add borrower to save the generated identity and access selection.' },
 { title: 'Open borrower details', description: 'Find silver-otter in the borrower table and select Details.' },
 { title: 'Archive the borrower', description: 'Select Archive borrower. Archived records can be restored in the full application.' },
 { title: 'Borrower management complete', description: 'You added a borrower, set their tenant account access, and archived the record. Select Continue to explore item management.' },
 { title: 'Add an item', description: 'Enter the sample item name.', value: 'Tablet' },
 { title: 'Enter a barcode', description: 'Enter the barcode for the new item.', value: 'IT-2002' },
 { title: 'Enter a serial number', description: 'Enter the serial number for the tablet.', value: 'SN-2002' },
 { title: 'Add notes', description: 'Enter a note about the tablet.', value: 'Includes charging cable' },
 { title: 'Save the item', description: 'Select Add item to create the record.' },
 { title: 'Open item details', description: 'Find the tablet in the item list and select Details.' },
 { title: 'Edit the item', description: 'Select Edit item, change the item name, then select Save.', value: 'Tablet Pro' },
 { title: 'Archive the item', description: 'Select Archive item. Archived records can be restored in the full application.' },
 { title: 'Review item logs', description: 'The history shows the checkout and return you completed earlier.' },
];
const freeRoam = ref(false);
const step = ref(0), borrowerLoaded = ref(false), borrowerInput = ref(''), barcodeInput = ref(''), queued = ref(false), checkedOut = ref(false), borrowerCreated = ref(false), borrowerArchived = ref(false), itemCreated = ref(false), itemArchived = ref(false), editing = ref(false), itemName = ref(''), itemBarcode = ref(''), itemSerial = ref(''), itemNotes = ref(''), savedName = ref(''), editName = ref(''), copied = ref(false);
const accessMode = ref<'' | 'all' | 'restricted'>('all'); const selectedIds = ref<string[]>([]); const accounts = [{ id: 'staff', auth_email: 'staff@example.com' }, { id: 'admin', auth_email: 'admin@example.com' }];
const toastTitle = ref(''), toastMessage = ref(''), toastId = ref(0), isSubmitting = ref(false);
const toastUndo = ref<null | 'borrower' | 'item'>(null);
let toastTimer: number | undefined;
let transactionTimer: number | undefined;
let restoring = false;
const snapshots: ReturnType<typeof captureState>[] = [];
function captureState() {
  return {
    borrowerLoaded: borrowerLoaded.value, borrowerInput: borrowerInput.value, barcodeInput: barcodeInput.value,
    queued: queued.value, checkedOut: checkedOut.value, borrowerCreated: borrowerCreated.value,
    borrowerArchived: borrowerArchived.value, itemCreated: itemCreated.value, itemArchived: itemArchived.value,
    editing: editing.value, itemName: itemName.value, itemBarcode: itemBarcode.value,
    itemSerial: itemSerial.value, itemNotes: itemNotes.value, savedName: savedName.value,
    editName: editName.value, accessMode: accessMode.value, selectedIds: [...selectedIds.value],
  };
}
snapshots[0] = captureState();
watch(step, value => { if (!restoring) snapshots[value] = captureState(); }, { flush: 'sync' });
function goBack() {
  if (isSubmitting.value || step.value <= 0) return;
  const target = step.value - 1;
  const state = snapshots[target];
  if (!state) return;
  restoring = true;
  borrowerLoaded.value = state.borrowerLoaded; borrowerInput.value = state.borrowerInput; barcodeInput.value = state.barcodeInput;
  queued.value = state.queued; checkedOut.value = state.checkedOut; borrowerCreated.value = state.borrowerCreated;
  borrowerArchived.value = state.borrowerArchived; itemCreated.value = state.itemCreated; itemArchived.value = state.itemArchived;
  editing.value = state.editing; itemName.value = state.itemName; itemBarcode.value = state.itemBarcode;
  itemSerial.value = state.itemSerial; itemNotes.value = state.itemNotes; savedName.value = state.savedName;
  editName.value = state.editName; accessMode.value = state.accessMode; selectedIds.value = [...state.selectedIds];
  window.clearTimeout(toastTimer); toastMessage.value = ''; toastUndo.value = null;
  step.value = target;
  restoring = false;
}
const current = computed(() => steps[step.value] ?? steps[steps.length - 1]);
const workspaceElement = ref<HTMLElement | null>(null);
const overlayBounds = ref({ top: '0px', left: '0px', width: '0px', height: '0px' });
function updateOverlayBounds() {
  const rect = workspaceElement.value?.getBoundingClientRect();
  if (!rect) return;
  const top = Math.max(0, rect.top);
  const bottom = Math.min(window.innerHeight, rect.bottom);
  overlayBounds.value = { top: `${top}px`, left: `${rect.left}px`, width: `${rect.width}px`, height: `${Math.max(0, bottom - top)}px` };
}
onMounted(() => { window.addEventListener('scroll', updateOverlayBounds, { passive: true }); window.addEventListener('resize', updateOverlayBounds); updateOverlayBounds(); });
watch(step, value => { if (value === 11 || value === 19 || value === 20) void nextTick(updateOverlayBounds); });
watch(accessMode, value => { if (!restoring && step.value === 7 && value === 'restricted') step.value++; }, { flush: 'sync' });
watch(selectedIds, value => { if (!restoring && step.value === 8 && value.length === 1 && value[0] === 'staff') step.value++; }, { flush: 'sync' });
watch(itemName, value => { if (!restoring && step.value === 13 && value === 'Tablet') step.value++; }, { flush: 'sync' });
watch(itemBarcode, value => { if (!restoring && step.value === 14 && value === 'IT-2002') step.value++; }, { flush: 'sync' });
watch(itemSerial, value => { if (!restoring && step.value === 15 && value === 'SN-2002') step.value++; }, { flush: 'sync' });
watch(itemNotes, value => { if (!restoring && step.value === 16 && value === 'Includes charging cable') step.value++; }, { flush: 'sync' });
watch(step, () => { copied.value = false; });
function loadBorrower() { if ((step.value === 0 || step.value === 3) && borrowerInput.value === 'BR-1001') { borrowerLoaded.value = true; step.value++; } }
function addBarcode() { if ((step.value === 1 || step.value === 4) && barcodeInput.value === 'IT-1001') { queued.value = true; barcodeInput.value = ''; step.value++; } }
function completeTransaction() {
  if (isSubmitting.value || !queued.value || (step.value !== 2 && step.value !== 5)) return;
  isSubmitting.value = true;
  showToast('Transaction processing...', 'Please wait while your transaction is processed.', 0);
  transactionTimer = window.setTimeout(() => {
    checkedOut.value = step.value === 2;
    queued.value = false;
    borrowerInput.value = '';
    borrowerLoaded.value = false;
    isSubmitting.value = false;
    showToast('Transaction complete (Success).', `processed:\n${checkedOut.value ? 1 : 0} checkout(s)\n${checkedOut.value ? 0 : 1} return(s)`, 9000);
    step.value++;
    transactionTimer = undefined;
  }, 1500);
}
function showToast(title: string, message: string, duration = 4000, undo: null | 'borrower' | 'item' = null) {
  window.clearTimeout(toastTimer);
  toastTitle.value = title; toastMessage.value = message; toastUndo.value = undo; toastId.value++;
  if (duration > 0) toastTimer = window.setTimeout(() => { toastMessage.value = ''; toastUndo.value = null; }, duration);
}
function createBorrower() { borrowerCreated.value = true; showToast('Success', 'Borrower added.'); step.value++; }
function archiveBorrower() { borrowerArchived.value = true; showToast('Borrower archived', 'silver-otter was archived.', 7000, 'borrower'); step.value++; }
function createItem() { if (step.value !== 17) return; itemCreated.value = true; savedName.value = itemName.value; editName.value = itemName.value; showToast('Success', 'Item added.'); step.value++; }
function saveItem() { savedName.value = editName.value; showToast('Success', 'Item updated.'); step.value++; }
function archiveItem() { itemArchived.value = true; showToast('Item archived', `${savedName.value} was archived.`, 7000, 'item'); step.value++; }
function undoArchive() {
  if (toastUndo.value === 'borrower') { borrowerArchived.value = false; step.value = 11; showToast('Success', 'Borrower restored.'); }
  else if (toastUndo.value === 'item') { itemArchived.value = false; step.value = 20; showToast('Success', 'Item restored.'); }
}
onUnmounted(() => { window.clearTimeout(toastTimer); window.clearTimeout(transactionTimer); window.removeEventListener('scroll', updateOverlayBounds); window.removeEventListener('resize', updateOverlayBounds); });
function insertValue() { const value = current.value.value; if (!value) return; if (step.value === 0 || step.value === 3) borrowerInput.value = value; else if (step.value === 1 || step.value === 4) barcodeInput.value = value; else if (step.value === 13) itemName.value = value; else if (step.value === 14) itemBarcode.value = value; else if (step.value === 15) itemSerial.value = value; else if (step.value === 16) itemNotes.value = value; else if (step.value === 19 && editing.value) editName.value = value; }
async function copyValue() { try { await navigator.clipboard.writeText(current.value.value || ''); copied.value = true; } catch { copied.value = false; } }
function restart() { window.location.reload(); }
</script>
<style scoped>
:global(html.demo-route-active) { zoom: 100%; }
.demo { --surface: #fff; --surface-2: #f1f1ee; --border: #d8d8d3; --muted: #5f6368; --accent: #171717; --text: #171717; color: #171717; background: #f7f7f5; min-height: 100vh; min-height: 100dvh; display: flex; flex-direction: column; }
.demo-notice { background: #171717; color: #fff; text-align: center; padding: .8rem 1rem; font-size: .9rem; }
.demo-notice a { color: #fff; margin-left: 1rem; text-decoration: underline; }
.demo-layout { display: grid; grid-template-columns: minmax(0, 2fr) minmax(290px, 1fr); flex: 1; }
.workspace { min-width: 0; zoom: 90%; }
.workspace-body { padding: 1.5rem; }
.workspace .page { max-width: 950px; margin: auto; padding: 0; }
.checkout-brand-title { margin: 0; }
.checkout-brand-logo { display: block; height: 72px; width: auto; object-fit: contain; }
.workspace .card { background: #fff; border: 1px solid var(--border); border-radius: 16px; padding: 1.5rem; }
.checkout-page { display: grid; gap: .9rem; }
.checkout-page-copy { margin: 0; color: var(--muted); font-size: 1rem; }
.checkout-input-row { gap: .55rem; align-items: center; }
.checkout-input-row input { height: 2.2rem; min-height: 2.2rem; padding: 0 .72rem; border-radius: 12px; border: 1px solid color-mix(in srgb, var(--border) 72%, var(--accent) 28%); background: color-mix(in srgb, var(--surface) 88%, transparent 12%); font-size: .92rem; line-height: 1.1; }
.workspace .checkout-inline-button { min-width: 7rem; min-height: 2rem; padding: .3rem .7rem; border-radius: 12px; white-space: nowrap; }
.checkout-actions { margin-top: 1rem; }
.workspace .checkout-submit-button { min-height: 2.2rem; padding-inline: .85rem; border-radius: 12px; }
.workspace label { display: block; }
.workspace input, .workspace textarea { color: #171717; }
.workspace input[readonly], .workspace textarea[readonly] { background: #f1f1ee; }
.input-row { display: flex; gap: .5rem; }
.workspace button { color: #171717; background: #fff; border-color: #d8d8d3; }
.workspace button:disabled { opacity: .5; cursor: not-allowed; }
.workspace .button-primary, .workspace .button-primary:hover:not(:disabled) { color: #fff; background: #171717; border-color: #171717; }
.admin-summary-card span, .muted { color: #5f6368; }
.table-wrap { overflow: auto; }
.details { border: 1px solid var(--border); }
.demo-modal-backdrop { position: fixed; display: flex; align-items: center; justify-content: center; padding: 1rem; box-sizing: border-box; background: rgba(10, 14, 25, .55); z-index: 1000; color: #171717; }
.demo-modal { width: min(680px, 100%); max-height: 90%; overflow: auto; box-sizing: border-box; border: 1px solid #d8d8d3; border-radius: 12px; background: #fff; padding: 1rem; }
.demo-modal h3 { margin-top: .25rem; margin-bottom: .5rem; }
.demo-modal .admin-actions { margin-top: .75rem; }
.demo-modal button { background: #fff; color: #171717; border-color: #d8d8d3; }
.success { color: #171717; }
.tag { border-radius: 20px; padding: .2rem .6rem; }
.tag-checkout { color: #00894f; }
.tag-return { color: #b91c1c; }
.demo .demo-toast { position: fixed; right: calc(max(33.333333vw, 290px) + 24px); bottom: 24px; max-width: calc(66.666667vw - 48px); box-sizing: border-box; }
:global(:root[data-theme]) .demo .demo-toast { background: #fff; color: #171717; border-color: #d8d8d3; }
.guide { background: #fff; border-left: 1px solid #d8d8d3; padding: 2.2rem; display: flex; flex-direction: column; align-items: flex-start; gap: 1rem; }
.progress-label { width: 100%; display: flex; justify-content: space-between; font-size: .8rem; color: #5f6368; }
.progress { width: 100%; height: 5px; background: #e9e9e3; border-radius: 5px; }
.progress span { display: block; height: 100%; background: #171717; border-radius: 5px; }
.guide h2 { font-size: 1.8rem; line-height: 1.15; margin: 1.5rem 0 0; }
.guide p { line-height: 1.6; color: #5f6368; }
.value-box { display: grid; gap: .6rem; width: 100%; padding: 1rem; background: #f7f7f5; border: 1px solid #d8d8d3; border-radius: 12px; box-sizing: border-box; }
.value-box > span { font-size: .75rem; color: #5f6368; }
.copy-value { display: flex; justify-content: space-between; background: #fff; color: #171717; border: 1px solid #d8d8d3; padding: .75rem; border-radius: 7px; font-weight: 700; cursor: pointer; }
.copy-value small { color: #5f6368; }
.insert, .guide-next, .insert:hover:not(:disabled), .guide-next:hover { border: 1px solid #171717; border-radius: 8px; padding: .8rem 1rem; background: #171717; color: #fff; font-weight: 700; text-decoration: none; cursor: pointer; }
.insert:hover:not(:disabled), .guide-next:hover { background: #333; }
.guide-back, .guide-back:hover:not(:disabled) { background: transparent; border: 0; padding: 0; min-height: 0; color: #171717; }
.guide-back:disabled { opacity: .5; cursor: not-allowed; }
.guide-footnote { margin-top: auto; font-size: .8rem; }
.hint { font-size: .85rem; }
.restart { border: 0; background: none; color: #171717; cursor: pointer; }
@media (max-width: 760px) { .checkout-input-row { flex-direction: column; align-items: stretch; } .workspace .checkout-inline-button, .workspace .checkout-submit-button { width: 100%; } }
@media (max-width: 800px) { .demo .demo-toast { right: 24px; max-width: calc(100vw - 48px); } .demo-layout { display: flex; flex-direction: column-reverse; } .guide { border: 0; padding: 1.5rem; } .guide h2 { margin-top: .5rem; } .guide-back, .guide-back:hover:not(:disabled) { background: transparent; border: 0; padding: 0; min-height: 0; color: #171717; }
.guide-back:disabled { opacity: .5; cursor: not-allowed; }
.guide-footnote { margin: 0; } .workspace-body { padding: 1rem; } }
</style>
