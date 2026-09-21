<template>
  <main class="page">
    <div class="sa-toolbar">
      <div>
        <RouterLink to="/super-admin" class="sa-back-link">&larr; Back to Control Center</RouterLink>
        <h1 class="sa-toolbar-title">Individual Accounts</h1>
        <p class="sa-toolbar-sub">Create and manage personal accounts that use the root app. They do not use workspace slugs or customer-facing subdomains.</p>
      </div>
    </div>

    <div class="sa-stat-strip" aria-label="Individual account summary">
      <div class="sa-stat"><div class="n">{{ accounts.length }}</div><div class="l">Total</div></div>
      <div class="sa-stat"><div class="n">{{ activeCount }}</div><div class="l">Active</div></div>
      <div class="sa-stat"><div class="n">{{ suspendedCount }}</div><div class="l">Suspended</div></div>
      <div class="sa-stat"><div class="n">{{ archivedCount }}</div><div class="l">Archived</div></div>
    </div>

    <section class="sa-panel">
      <h2>Create individual account</h2>
      <AccountFields v-model="draft" :include-credentials="true" />
      <div class="panel-actions">
        <button class="sa-btn primary" :disabled="saving" @click="create">Create individual account</button>
      </div>
    </section>

    <section class="sa-panel sa-filters">
      <label>Search <input v-model="search" placeholder="Name or email" @keyup.enter="load" /></label>
      <label>Status
        <select v-model="status" @change="load">
          <option value="all">All</option><option value="active">Active</option>
          <option value="suspended">Suspended</option><option value="archived">Archived</option>
        </select>
      </label>
      <button class="sa-btn" :disabled="loading" @click="load">Search</button>
    </section>

    <p v-if="message" class="sa-notice" role="status">{{ message }}</p>
    <p v-if="error" class="sa-error" role="alert">{{ error }}</p>

    <div class="sa-table-wrap">
      <table class="sa-table">
        <thead><tr><th>Name</th><th>Sign-in email</th><th>App address</th><th>Plan</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          <tr v-for="account in accounts" :key="account.id">
            <td>{{ account.name }}</td>
            <td><span data-session-replay-mask>{{ account.primary_admin_email || "Not assigned" }}</span></td>
            <td><a href="https://itemtraxx.com/checkout" target="_blank" rel="noreferrer">itemtraxx.com/checkout</a></td>
            <td>{{ account.plan_code || "unassigned" }}</td>
            <td><span class="sa-tag" :class="account.archived_at ? 'info' : account.status === 'active' ? 'ok' : 'warn'">{{ account.archived_at ? "archived" : account.status }}</span></td>
            <td>
              <div class="sa-table-row-actions">
                <button class="sa-btn" @click="openEdit(account)">Edit</button>
                <button class="sa-btn" @click="toggle(account)">{{ account.archived_at ? "Reactivate" : account.status === "active" ? "Suspend" : "Activate" }}</button>
                <button class="sa-btn danger" :disabled="!!account.archived_at" @click="archiveAccount(account)">Archive</button>
                <button class="sa-btn" @click="reset(account)">Reset password</button>
              </div>
            </td>
          </tr>
          <tr v-if="!loading && !accounts.length"><td colspan="6">No individual accounts found.</td></tr>
        </tbody>
      </table>
    </div>

    <div v-if="editing" class="sa-modal-backdrop" @click.self="editing = null">
      <section class="sa-modal" role="dialog" aria-modal="true" aria-labelledby="edit-individual-account-title">
        <h2 id="edit-individual-account-title">Edit individual account</h2>
        <AccountFields v-model="editDraft" :show-email="true" />
        <div class="panel-actions">
          <button class="sa-btn primary" :disabled="saving" @click="saveEdit">Save changes</button>
          <button class="sa-btn" @click="editing = null">Cancel</button>
        </div>
      </section>
    </div>
  </main>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, onMounted, ref, type PropType } from "vue";
import { RouterLink } from "vue-router";
import {
  createIndividualAccount,
  listIndividualAccounts,
  sendIndividualAccountReset,
  setIndividualAccountStatus,
  updateIndividualAccount,
  type IndividualAccountCreateInput,
  type SuperIndividualAccount,
} from "../../services/superIndividualAccountService";

type AccountForm = IndividualAccountCreateInput & { id?: string };
const defaultFlags = () => ({
  enable_notifications: true,
  enable_bulk_item_import: true,
  enable_bulk_borrower_tools: true,
  enable_status_tracking: true,
  enable_barcode_generator: true,
});
const blankDraft = (): AccountForm => ({
  name: "",
  auth_email: "",
  password: "",
  plan_code: "individual_yearly",
  max_items: null,
  max_borrowers: null,
  checkout_due_hours: 72,
  feature_flags: defaultFlags(),
  contact_name: "",
  support_email: "",
  billing_email: "",
  billing_status: "draft",
  renewal_date: "",
  invoice_reference: "",
});

const AccountFields = defineComponent({
  props: {
    modelValue: { type: Object as PropType<AccountForm>, required: true },
    includeCredentials: Boolean,
    showEmail: Boolean,
  },
  emits: ["update:modelValue"],
  setup(props, { emit }) {
    const update = (key: keyof AccountForm, value: unknown) => emit("update:modelValue", { ...props.modelValue, [key]: value });
    const input = (label: string, key: keyof AccountForm, type = "text", extra: Record<string, unknown> = {}) =>
      h("label", [label, h("input", { type, value: props.modelValue[key] ?? "", ...extra, onInput: (event: Event) => update(key, (event.target as HTMLInputElement).value) })]);
    const flagLabels: Record<string, string> = {
      enable_notifications: "Notifications",
      enable_bulk_item_import: "Bulk item import",
      enable_bulk_borrower_tools: "Bulk borrower tools",
      enable_status_tracking: "Item status tracking",
      enable_barcode_generator: "Barcode generator",
    };
    return () => h("div", { class: "fields" }, [
      input("Account name", "name"),
      ...(props.includeCredentials || props.showEmail
        ? [input("Sign-in email", "auth_email", "email")]
        : []),
      ...(props.includeCredentials ? [input("Temporary password (optional)", "password", "password", { autocomplete: "new-password" })] : []),
      h("label", ["Plan", h("select", { value: props.modelValue.plan_code ?? "individual_yearly", onChange: (event: Event) => update("plan_code", (event.target as HTMLSelectElement).value) }, [
        h("option", { value: "individual_yearly" }, "Individual yearly"),
        h("option", { value: "individual_monthly" }, "Individual monthly"),
      ])]),
      h("label", ["Active item limit", h("input", { type: "number", min: 1, value: props.modelValue.max_items ?? "", placeholder: "Unlimited", onInput: (event: Event) => { const value = (event.target as HTMLInputElement).value; update("max_items", value ? Number(value) : null); } })]),
      h("label", ["Active borrower limit", h("input", { type: "number", min: 1, value: props.modelValue.max_borrowers ?? "", placeholder: "Unlimited", onInput: (event: Event) => { const value = (event.target as HTMLInputElement).value; update("max_borrowers", value ? Number(value) : null); } })]),
      h("label", ["Checkout due limit (hours)", h("input", { type: "number", min: 1, max: 720, value: props.modelValue.checkout_due_hours, onInput: (event: Event) => update("checkout_due_hours", Number((event.target as HTMLInputElement).value)) })]),
      input("Contact name", "contact_name"),
      input("Support email", "support_email", "email"),
      input("Billing email", "billing_email", "email"),
      h("label", ["Billing status", h("select", { value: props.modelValue.billing_status ?? "draft", onChange: (event: Event) => update("billing_status", (event.target as HTMLSelectElement).value) }, [
        ...["draft", "active", "past_due", "canceled"].map((value) => h("option", { value }, value.replace("_", " "))),
      ])]),
      input("Renewal date", "renewal_date", "date"),
      input("Invoice reference", "invoice_reference"),
      h("fieldset", { class: "sa-flag-fieldset" }, [
        h("legend", "Feature flags"),
        h("div", { class: "sa-flag-grid" }, Object.entries(flagLabels).map(([key, label]) => h("label", { class: "sa-flag-row" }, [
          h("input", { type: "checkbox", class: "sa-flag-checkbox", checked: props.modelValue.feature_flags[key] !== false, onChange: (event: Event) => update("feature_flags", { ...props.modelValue.feature_flags, [key]: (event.target as HTMLInputElement).checked }) }),
          h("span", label),
        ]))),
      ]),
    ]);
  },
});

const accounts = ref<SuperIndividualAccount[]>([]);
const search = ref("");
const status = ref("all");
const message = ref("");
const error = ref("");
const loading = ref(false);
const saving = ref(false);
const editing = ref<SuperIndividualAccount | null>(null);
const draft = ref<AccountForm>(blankDraft());
const editDraft = ref<AccountForm>(blankDraft());
const activeCount = computed(() => accounts.value.filter((item) => item.status === "active" && !item.archived_at).length);
const suspendedCount = computed(() => accounts.value.filter((item) => item.status === "suspended" && !item.archived_at).length);
const archivedCount = computed(() => accounts.value.filter((item) => !!item.archived_at).length);

const run = async (operation: () => Promise<void>, success: string) => {
  saving.value = true;
  error.value = "";
  message.value = "";
  try {
    await operation();
    message.value = success;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Individual account operation failed.";
  } finally {
    saving.value = false;
  }
};
const load = async () => {
  loading.value = true;
  error.value = "";
  try {
    accounts.value = await listIndividualAccounts(search.value, status.value);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Unable to load individual accounts.";
  } finally {
    loading.value = false;
  }
};
const create = () => run(async () => {
  const payload = { ...draft.value };
  if (!payload.password) delete payload.password;
  await createIndividualAccount(payload);
  draft.value = blankDraft();
  await load();
}, "Individual account created.");
const openEdit = (account: SuperIndividualAccount) => {
  editing.value = account;
  editDraft.value = {
    ...blankDraft(),
    ...account,
    auth_email: account.primary_admin_email ?? "",
    password: "",
    feature_flags: { ...defaultFlags(), ...(account.feature_flags ?? {}) },
  };
};
const saveEdit = () => editing.value && run(async () => {
  const { id, name, auth_email, plan_code, max_items, max_borrowers, checkout_due_hours, feature_flags, contact_name, support_email, billing_email, billing_status, renewal_date, invoice_reference } = editDraft.value;
  await updateIndividualAccount({ id: id!, name, auth_email, plan_code, max_items, max_borrowers, checkout_due_hours, feature_flags, contact_name, support_email, billing_email, billing_status, renewal_date, invoice_reference });
  editing.value = null;
  await load();
}, "Individual account updated.");
const toggle = (account: SuperIndividualAccount) => run(async () => {
  await setIndividualAccountStatus(account.id, account.status === "active" ? "suspended" : "active");
  await load();
}, "Individual account status updated.");
const archiveAccount = (account: SuperIndividualAccount) => {
  if (confirm(`Archive ${account.name}?`)) void run(async () => {
    await setIndividualAccountStatus(account.id, "archived");
    await load();
  }, "Individual account archived.");
};
const reset = (account: SuperIndividualAccount) => run(async () => {
  await sendIndividualAccountReset(account.id);
}, "Password reset link requested.");

onMounted(() => void load());
</script>

<style scoped>
.page { max-width: 1320px; margin: 0 auto; padding: 2rem; }
.panel-actions { display: flex; gap: 0.5rem; margin-top: 1rem; }
.fields { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1rem; }
.fields label { display: grid; gap: 0.35rem; }
.fields input[readonly] { background: var(--surface-2); }
@media (max-width: 800px) { .fields { grid-template-columns: 1fr 1fr; } }
@media (max-width: 520px) { .fields { grid-template-columns: 1fr; } }
</style>
