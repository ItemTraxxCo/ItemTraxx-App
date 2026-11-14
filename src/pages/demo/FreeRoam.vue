<template>
  <div class="roam page">
    <nav class="roam-nav" aria-label="Explore demo"><button v-for="tab in tabs" :key="tab.id" :class="{ active: view === tab.id }" :aria-current="view === tab.id ? 'page' : undefined" :disabled="processing" @click="view = tab.id">{{ tab.label }}</button></nav>
    <template v-if="view === 'checkout'">
      <h1 class="brand"><img :src="brandLogoUrl" alt="ItemTraxx" /></h1><p>Checkout and return</p>
      <div class="card">
        <label>Borrower ID<select v-model="selectedBorrower" :disabled="processing" @change="queuedItem = ''"><option value="">Select a borrower</option><option v-for="borrower in activeBorrowers" :key="borrower.id" :value="borrower.id">{{ borrower.name }} ({{ borrower.id }})</option></select></label>
        <p v-if="!selectedBorrower" class="muted">Select a borrower to begin.</p>
        <template v-else><h3>{{ selectedBorrowerRecord?.name }} <span class="muted">ID: {{ selectedBorrower }}</span></h3><p v-if="borrowedItems.length">Currently checked out: {{ borrowedItems.map(item => item.name).join(', ') }}</p><p v-else class="muted">No items currently checked out.</p>
          <label>Item barcode<select v-model="queuedItem" :disabled="processing"><option value="">Select an item</option><option v-for="item in availableItems" :key="item.barcode" :value="item.barcode">{{ item.name }} ({{ item.barcode }}) — {{ item.borrowerId ? 'Return' : 'Checkout' }}</option></select></label>
          <p v-if="queuedItem">{{ selectedItem?.name }} <span class="tag" :class="selectedItem?.borrowerId ? 'tag-return' : 'tag-checkout'">{{ selectedItem?.borrowerId ? 'Return' : 'Checkout' }}</span></p>
          <button class="button-primary" :disabled="!queuedItem || processing" @click="transact">Complete transaction</button>
        </template>
      </div>
    </template>
    <template v-else-if="view === 'borrowers'">
      <div class="admin-hero"><h1>Borrower Management</h1><p class="muted">Add borrowers, review details, and manage archived records.</p></div>
      <div class="card"><h2>Add Borrower</h2><p class="muted">Generate a new borrower identity and add it to this tenant.</p><label>Username<input value="silver-otter" readonly /></label><label>Borrower ID<input value="BR-2002" readonly /></label><TenantAccessPicker v-model:access-mode="accessMode" v-model:selected-ids="selectedIds" :accounts="accounts" /><button class="button-primary" :disabled="borrowers.some(b => b.id === 'BR-2002') || (accessMode === 'restricted' && !selectedIds.length)" @click="addBorrower">Add borrower</button></div>
      <div class="card"><h2>Borrowers</h2><div class="table-wrap"><table class="table"><thead><tr><th>Username</th><th>Borrower ID</th><th>Tenant Accounts</th><th></th></tr></thead><tbody><tr v-for="borrower in activeBorrowers" :key="borrower.id"><td>{{ borrower.name }}</td><td>{{ borrower.id }}</td><td>{{ borrower.access }}</td><td><button :disabled="items.some(item => item.borrowerId === borrower.id)" :title="items.some(item => item.borrowerId === borrower.id) ? 'Return checked out items first' : ''" @click="borrower.archived = true; notify('Borrower archived.')">Archive</button></td></tr></tbody></table></div><p class="muted">Return a borrower’s checked-out items before archiving them.</p></div>
      <div class="card"><h2>Archived Borrowers</h2><p v-if="!borrowers.some(b => b.archived)" class="muted">No archived borrowers.</p><p v-for="borrower in borrowers.filter(b => b.archived)" :key="borrower.id">{{ borrower.name }} <button @click="borrower.archived = false; notify('Borrower restored.')">Restore</button></p></div>
    </template>
    <template v-else-if="view === 'items'">
      <div class="admin-hero"><h1>Item Management</h1><p class="muted">Add inventory, update item status, and review archived items.</p></div>
      <div class="card"><h2>Add Item</h2><p class="muted">Add the sample tablet to the inventory.</p><label>Name<input value="Tablet" readonly /></label><label>Barcode<input value="IT-2002" readonly /></label><label>Serial number<input value="SN-2002" readonly /></label><label>Notes<textarea readonly rows="2">Includes charging cable</textarea></label><button class="button-primary" :disabled="items.some(i => i.barcode === 'IT-2002')" @click="addItem">Add item</button></div>
      <div class="card"><h2>Item List</h2><div class="table-wrap"><table class="table"><thead><tr><th>Name</th><th>Barcode</th><th>Serial</th><th>Status</th><th>Notes</th><th></th></tr></thead><tbody><tr v-for="item in items.filter(i => !i.archived)" :key="item.barcode"><td>{{ item.name }}</td><td>{{ item.barcode }}</td><td>{{ item.serial || '—' }}</td><td>{{ item.borrowerId ? 'Checked out' : 'Available' }}</td><td>{{ item.notes || '—' }}</td><td><button @click="openItem(item)">Details</button></td></tr></tbody></table></div></div>
      <div class="card"><h2>Archived Items</h2><p v-if="!items.some(i => i.archived)" class="muted">No archived items.</p><p v-for="item in items.filter(i => i.archived)" :key="item.barcode">{{ item.name }} <button @click="item.archived = false; notify('Item restored.')">Restore</button></p></div>
      <div v-if="editingItem && editingRecord" class="details card" role="region" aria-label="Item details"><h2>Item details</h2><label>Name<select v-model="editName"><option v-for="name in editingRecord.barcode === 'IT-1001' ? ['Laptop', 'Laptop Pro'] : ['Tablet', 'Tablet Pro']" :key="name">{{ name }}</option></select></label><label>Barcode<input :value="editingRecord.barcode" readonly /></label><label>Serial number<input :value="editingRecord.serial || '—'" readonly /></label><label>Notes<input :value="editingRecord.notes || '—'" readonly /></label><div class="actions"><button @click="saveItem">Save</button><button :disabled="!!editingRecord.borrowerId" title="Return checked-out items before archiving" @click="archiveItem">Archive item</button><button @click="editingItem = ''">Close</button></div><p v-if="editingRecord.borrowerId" class="muted">Return this item before archiving it.</p></div>
    </template>
    <template v-else><div class="admin-hero"><h1>Item Logs</h1><p class="muted">Review the checkout and return activity from this exploration.</p></div><div class="card"><h2>History</h2><p v-if="!logs.length" class="muted">No transactions yet.</p><div v-else class="table-wrap"><table class="table"><thead><tr><th>Time</th><th>Action</th><th>Borrower</th><th>Item</th></tr></thead><tbody><tr v-for="log in logs" :key="log.id"><td>{{ log.time }}</td><td>{{ log.action }}</td><td>{{ log.borrower }}</td><td>{{ log.item }}</td></tr></tbody></table></div></div></template>
    <p v-if="message" class="roam-message" role="status">{{ message }}</p>
  </div>
</template>
<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import TenantAccessPicker from '../../components/app/TenantAccessPicker.vue';
type Borrower = { id: string; name: string; access: string; archived: boolean };
type Item = { barcode: string; name: string; serial: string; notes: string; borrowerId: string; archived: boolean };
const brandLogoUrl = import.meta.env.VITE_BRAND_LOGO_LIGHT_URL || '/brand/logo-light.png';
const tabs = [{ id: 'checkout', label: 'Checkout and return' }, { id: 'borrowers', label: 'Borrowers' }, { id: 'items', label: 'Items' }, { id: 'logs', label: 'Item logs' }] as const;
const view = ref<(typeof tabs)[number]['id']>('checkout');
const borrowers = ref<Borrower[]>([{ id: 'BR-1001', name: 'Alex Morgan', access: 'All', archived: false }]);
const items = ref<Item[]>([{ barcode: 'IT-1001', name: 'Laptop', serial: '', notes: '', borrowerId: '', archived: false }]);
const accounts = [{ id: 'staff', auth_email: 'staff@example.com' }, { id: 'admin', auth_email: 'admin@example.com' }];
const accessMode = ref<'' | 'all' | 'restricted'>('all'), selectedIds = ref<string[]>([]);
const selectedBorrower = ref(''), queuedItem = ref(''), editingItem = ref(''), editName = ref(''), message = ref(''), processing = ref(false);
const logs = ref<Array<{ id: number; time: string; action: string; borrower: string; item: string }>>([]);
let timer: number | undefined, messageTimer: number | undefined;
const activeBorrowers = computed(() => borrowers.value.filter(b => !b.archived));
const selectedBorrowerRecord = computed(() => activeBorrowers.value.find(b => b.id === selectedBorrower.value));
const borrowedItems = computed(() => items.value.filter(i => i.borrowerId === selectedBorrower.value && !!selectedBorrower.value));
const availableItems = computed(() => items.value.filter(i => !i.archived && (!i.borrowerId || i.borrowerId === selectedBorrower.value)));
const selectedItem = computed(() => availableItems.value.find(i => i.barcode === queuedItem.value));
const editingRecord = computed(() => items.value.find(i => i.barcode === editingItem.value));
watch(view, () => { editingItem.value = ''; message.value = ''; });
function notify(text: string) { message.value = text; window.clearTimeout(messageTimer); messageTimer = window.setTimeout(() => { message.value = ''; }, 4000); }
function addBorrower() { if (borrowers.value.some(b => b.id === 'BR-2002')) return; borrowers.value.push({ id: 'BR-2002', name: 'silver-otter', access: accessMode.value === 'all' ? 'All' : selectedIds.value.map(id => accounts.find(a => a.id === id)?.auth_email).filter(Boolean).join(', '), archived: false }); notify('Borrower added.'); }
function addItem() { if (items.value.some(i => i.barcode === 'IT-2002')) return; items.value.push({ barcode: 'IT-2002', name: 'Tablet', serial: 'SN-2002', notes: 'Includes charging cable', borrowerId: '', archived: false }); notify('Item added.'); }
function openItem(item: Item) { editingItem.value = item.barcode; editName.value = item.name; }
function saveItem() { if (!editingRecord.value) return; editingRecord.value.name = editName.value; editingItem.value = ''; notify('Item updated.'); }
function archiveItem() { if (!editingRecord.value || editingRecord.value.borrowerId) return; editingRecord.value.archived = true; editingItem.value = ''; notify('Item archived.'); }
function transact() { const item = selectedItem.value, borrower = selectedBorrowerRecord.value; if (!item || !borrower || processing.value) return; processing.value = true; notify('Transaction processing...'); timer = window.setTimeout(() => { const action = item.borrowerId ? 'Return' : 'Checkout'; item.borrowerId = item.borrowerId ? '' : borrower.id; logs.value.unshift({ id: Date.now(), time: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }), action, borrower: `${borrower.name} (${borrower.id})`, item: `${item.name} (${item.barcode})` }); queuedItem.value = ''; selectedBorrower.value = ''; processing.value = false; notify('Transaction complete.'); }, 1500); }
onUnmounted(() => { window.clearTimeout(timer); window.clearTimeout(messageTimer); });
</script>
<style scoped>
.roam { color: #171717; }.roam-nav { display:flex; flex-wrap:wrap; gap:.5rem; margin-bottom:1.5rem; }.roam-nav button { background:#fff; color:#171717; border-color:#d8d8d3; }.roam-nav button.active { background:#171717; color:#fff; }.brand { margin:0; }.brand img { height:72px; width:auto; display:block; }.roam .card { background:#fff; border-color:#d8d8d3; }.roam label { display:block; margin:.8rem 0; }.roam input,.roam select,.roam textarea { background:#fff; color:#171717; border-color:#d8d8d3; }.roam button { color:#171717; background:#fff; border-color:#d8d8d3; }.roam button:disabled { opacity:.5; cursor:not-allowed; }.roam .button-primary { color:#fff; background:#171717; border-color:#171717; }.roam .admin-hero { margin-bottom:1.25rem; }.muted { color:#5f6368; }.table-wrap { overflow:auto; }.access-picker { margin:1rem 0; }.details { border:1px solid #171717; }.actions { display:flex; gap:.5rem; margin-top:1rem; }.roam-message { position:sticky; bottom:1rem; margin-left:auto; width:fit-content; background:#fff; padding:1rem; border:1px solid #d8d8d3; border-radius:12px; }.tag-checkout { color:#00894f; }.tag-return { color:#b91c1c; }
</style>
