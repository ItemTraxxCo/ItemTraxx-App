<template>
  <main class="page">
    <header class="page-header">
      <div>
        <RouterLink to="/super-admin">Back to Control Center</RouterLink>
        <h1>Workspaces</h1>
        <p>Manage workspace identity, billing classification, feature access, lifecycle, and Primary Workspace Admins.</p>
      </div>
    </header>

    <section class="summary-grid" aria-label="Workspace summary">
      <article><strong>{{ workspaces.length }}</strong><span>Total</span></article>
      <article><strong>{{ activeCount }}</strong><span>Active</span></article>
      <article><strong>{{ suspendedCount }}</strong><span>Suspended</span></article>
      <article><strong>{{ archivedCount }}</strong><span>Archived</span></article>
    </section>

    <section class="card">
      <h2>Create workspace</h2>
      <WorkspaceFields v-model="draft" :include-credentials="true" />
      <div class="actions">
        <button class="button-primary" :disabled="saving" @click="create">Create workspace</button>
      </div>
    </section>

    <section class="card filters">
      <label>Search <input v-model="search" placeholder="Name or slug" @keyup.enter="load" /></label>
      <label>Status
        <select v-model="status" @change="load">
          <option value="all">All</option><option value="active">Active</option>
          <option value="suspended">Suspended</option><option value="archived">Archived</option>
        </select>
      </label>
      <button :disabled="loading" @click="load">Search</button>
    </section>

    <p v-if="message" class="notice" role="status">{{ message }}</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <div class="table-wrap">
      <table>
        <thead><tr><th>Name</th><th>Subdomain</th><th>Classification</th><th>Status</th><th>Primary Workspace Admin</th><th>Actions</th></tr></thead>
        <tbody>
          <tr v-for="workspace in workspaces" :key="workspace.id">
            <td>{{ workspace.name }}</td>
            <td><a :href="workspaceUrl(workspace.slug)" target="_blank" rel="noreferrer">{{ workspace.slug }}.app.itemtraxx.com</a></td>
            <td>{{ workspace.account_category || 'organization' }} / {{ workspace.plan_code || 'unassigned' }}</td>
            <td>{{ workspace.archived_at ? 'archived' : workspace.status }}</td>
            <td>{{ workspace.primary_admin_email || 'Not assigned' }}</td>
            <td class="row-actions">
              <button @click="openEdit(workspace)">Edit</button>
              <button @click="toggle(workspace)">{{ workspace.status === 'active' ? 'Suspend' : 'Activate' }}</button>
              <button @click="archiveWorkspace(workspace)">Archive</button>
              <button @click="reset(workspace)">Reset primary password</button>
              <button @click="reassign(workspace)">Reassign primary</button>
            </td>
          </tr>
          <tr v-if="!loading && !workspaces.length"><td colspan="6">No workspaces found.</td></tr>
        </tbody>
      </table>
    </div>

    <div v-if="editing" class="modal-backdrop" @click.self="editing = null">
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="edit-workspace-title">
        <h2 id="edit-workspace-title">Edit workspace</h2>
        <WorkspaceFields v-model="editDraft" :include-credentials="false" />
        <div class="actions">
          <button class="button-primary" :disabled="saving" @click="saveEdit">Save changes</button>
          <button @click="editing = null">Cancel</button>
        </div>
      </section>
    </div>
  </main>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, onMounted, ref, type PropType } from "vue";
import { RouterLink } from "vue-router";
import {
  createWorkspace,
  listWorkspaces,
  sendPrimaryWorkspaceAdminReset,
  setPrimaryWorkspaceAdmin,
  setWorkspaceStatus,
  updateWorkspace,
  type SuperWorkspace,
  type WorkspacePolicyInput,
} from "../../services/superWorkspaceService";

type WorkspaceDraft = WorkspacePolicyInput & { name: string; slug: string; auth_email: string; password: string };
const defaultFlags = () => ({ enable_notifications: true, enable_bulk_item_import: true, enable_bulk_borrower_tools: true, enable_status_tracking: true, enable_barcode_generator: true });
const blankDraft = (): WorkspaceDraft => ({ name: "", slug: "", auth_email: "", password: "", account_category: "organization", plan_code: "starter", checkout_due_hours: 72, feature_flags: defaultFlags(), contact_name: "", support_email: "", billing_email: "", billing_status: "draft", renewal_date: "", invoice_reference: "" });

const WorkspaceFields = defineComponent({
  props: { modelValue: { type: Object as PropType<WorkspaceDraft>, required: true }, includeCredentials: Boolean },
  emits: ["update:modelValue"],
  setup(props, { emit }) {
    const update = (key: keyof WorkspaceDraft, value: unknown) => emit("update:modelValue", { ...props.modelValue, [key]: value });
    const plans = computed(() => props.modelValue.account_category === "individual" ? [["individual_yearly", "Individual yearly"], ["individual_monthly", "Individual monthly"]] : props.modelValue.account_category === "district" ? [["core", "Core"], ["growth", "Growth"], ["enterprise", "Enterprise"]] : [["starter", "Starter"], ["scale", "Scale"], ["enterprise", "Enterprise"]]);
    const input = (label: string, key: keyof WorkspaceDraft, type = "text") => h("label", [label, h("input", { type, value: props.modelValue[key] ?? "", onInput: (event: Event) => update(key, (event.target as HTMLInputElement).value) })]);
    const flagLabels: Record<string, string> = { enable_notifications: "Notifications", enable_bulk_item_import: "Bulk item import", enable_bulk_borrower_tools: "Bulk borrower tools", enable_status_tracking: "Item status tracking", enable_barcode_generator: "Barcode generator" };
    return () => h("div", { class: "fields" }, [
      input("Workspace name", "name"), input("Workspace slug", "slug"),
      ...(props.includeCredentials ? [input("Primary admin email", "auth_email", "email"), input("Temporary password", "password", "password")] : []),
      h("label", ["Account category", h("select", { value: props.modelValue.account_category, onChange: (event: Event) => { const account_category = (event.target as HTMLSelectElement).value as WorkspaceDraft["account_category"]; const plan_code = account_category === "individual" ? "individual_yearly" : account_category === "district" ? "core" : "starter"; emit("update:modelValue", { ...props.modelValue, account_category, plan_code }); } }, [h("option", { value: "organization" }, "Organization"), h("option", { value: "district" }, "District"), h("option", { value: "individual" }, "Individual")])]),
      h("label", ["Plan", h("select", { value: props.modelValue.plan_code ?? "", onChange: (event: Event) => update("plan_code", (event.target as HTMLSelectElement).value) }, plans.value.map(([value, label]) => h("option", { value }, label)))]),
      h("label", ["Checkout due limit (hours)", h("input", { type: "number", min: 1, max: 720, value: props.modelValue.checkout_due_hours, onInput: (event: Event) => update("checkout_due_hours", Number((event.target as HTMLInputElement).value)) })]),
      input("Contact name", "contact_name"), input("Support email", "support_email", "email"), input("Billing email", "billing_email", "email"),
      h("label", ["Billing status", h("select", { value: props.modelValue.billing_status ?? "", onChange: (event: Event) => update("billing_status", (event.target as HTMLSelectElement).value) }, ["draft", "active", "past_due", "canceled"].map((value) => h("option", { value }, value.replace("_", " "))))]),
      input("Renewal date", "renewal_date", "date"), input("Invoice reference", "invoice_reference"),
      h("fieldset", [
        h("legend", "Feature flags"),
        ...Object.entries(flagLabels).map(([key, label]) => h("label", { class: "check" }, [
          h("input", { type: "checkbox", checked: props.modelValue.feature_flags[key] !== false, onChange: (event: Event) => update("feature_flags", { ...props.modelValue.feature_flags, [key]: (event.target as HTMLInputElement).checked }) }),
          label,
        ])),
      ]),
    ]);
  },
});

const workspaces = ref<SuperWorkspace[]>([]), search = ref(""), status = ref("all"), message = ref(""), error = ref(""), loading = ref(false), saving = ref(false), editing = ref<SuperWorkspace | null>(null);
const draft = ref(blankDraft()), editDraft = ref(blankDraft());
const activeCount = computed(() => workspaces.value.filter((item) => item.status === "active" && !item.archived_at).length);
const suspendedCount = computed(() => workspaces.value.filter((item) => item.status === "suspended" && !item.archived_at).length);
const archivedCount = computed(() => workspaces.value.filter((item) => !!item.archived_at).length);
const workspaceUrl = (slug: string) => `https://${slug}.app.itemtraxx.com`;
const run = async (operation: () => Promise<void>, success: string) => { saving.value = true; error.value = ""; message.value = ""; try { await operation(); message.value = success; } catch (cause) { error.value = cause instanceof Error ? cause.message : "Workspace operation failed."; } finally { saving.value = false; } };
const load = async () => { loading.value = true; error.value = ""; try { workspaces.value = await listWorkspaces(search.value, status.value); } catch (cause) { error.value = cause instanceof Error ? cause.message : "Unable to load workspaces."; } finally { loading.value = false; } };
const create = () => run(async () => { await createWorkspace(draft.value); draft.value = blankDraft(); await load(); }, "Workspace created. Add its exact origin to the Cloudflare allowlist before handoff.");
const openEdit = (workspace: SuperWorkspace) => { editing.value = workspace; editDraft.value = { ...blankDraft(), ...workspace, feature_flags: { ...defaultFlags(), ...(workspace.feature_flags ?? {}) } }; };
const saveEdit = () => editing.value && run(async () => { await updateWorkspace({ id: editing.value!.id, ...editDraft.value }); editing.value = null; await load(); }, "Workspace updated. Redeploy the origin allowlist if its slug changed.");
const toggle = (workspace: SuperWorkspace) => run(async () => { await setWorkspaceStatus(workspace.id, workspace.status === "active" ? "suspended" : "active"); await load(); }, "Workspace status updated.");
const archiveWorkspace = (workspace: SuperWorkspace) => { if (confirm(`Archive ${workspace.name}? Data enters the configured grace period and its origin must be removed manually.`)) void run(async () => { await setWorkspaceStatus(workspace.id, "archived"); await load(); }, "Workspace archived. Remove its origin from Cloudflare and redeploy the worker."); };
const reset = (workspace: SuperWorkspace) => run(async () => { await sendPrimaryWorkspaceAdminReset(workspace.id); }, "Primary Workspace Admin reset link requested.");
const reassign = (workspace: SuperWorkspace) => { const profileId = prompt("Workspace Admin profile ID to make primary")?.trim(); if (profileId) void run(async () => { await setPrimaryWorkspaceAdmin(workspace.id, profileId); await load(); }, "Primary Workspace Admin reassigned."); };
onMounted(() => void load());
</script>

<style scoped>
.page{max-width:1320px;margin:0 auto;padding:2rem}.page-header,.actions,.filters,.row-actions{display:flex;gap:.75rem;align-items:end;flex-wrap:wrap}.summary-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1rem;margin:1rem 0}.summary-grid article,.card{border:1px solid var(--border-color,#d7dce2);border-radius:12px;padding:1rem;background:var(--surface,#fff)}.summary-grid strong,.summary-grid span{display:block}.summary-grid strong{font-size:1.7rem}.fields{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1rem}.fields label{display:grid;gap:.35rem}.fields fieldset{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:1rem}.fields .check{display:flex;align-items:center}.table-wrap{overflow:auto;margin-top:1rem}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:.75rem;border-bottom:1px solid var(--border-color,#d7dce2);vertical-align:top}.row-actions{min-width:260px}.notice{color:#176b3a}.error{color:#a21d24}.modal-backdrop{position:fixed;inset:0;background:#0008;display:grid;place-items:center;padding:1rem;z-index:100}.modal{background:var(--surface,#fff);border-radius:12px;padding:1.5rem;max-width:1000px;width:100%;max-height:90vh;overflow:auto}@media(max-width:800px){.summary-grid,.fields{grid-template-columns:1fr 1fr}}@media(max-width:520px){.summary-grid,.fields{grid-template-columns:1fr}}
</style>
