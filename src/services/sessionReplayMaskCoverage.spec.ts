import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const coverageCases = [
  {
    name: "super-admin support requests",
    path: "../pages/super/SupportRequests.vue",
    snippets: [
      "data-session-replay-mask>{{ request.requester_name }}",
      'class="muted small" data-session-replay-mask>{{ request.reply_email }}',
      "data-session-replay-mask>{{ request.subject }}",
      "data-session-replay-mask>{{ selectedRequest.requester_name }}",
      "data-session-replay-mask>{{ selectedRequest.reply_email }}",
      "data-session-replay-mask>{{ selectedRequest.assigned_to_email || \"Unassigned\" }}",
      "data-session-replay-mask>{{ selectedRequest.subject }}",
      "data-session-replay-mask>{{ selectedRequest.message }}",
      ':href="safeExternalUrl(attachment.signed_url)"\n                data-session-replay-mask',
      'data-session-replay-mask\n                  :alt="attachment.original_filename || attachment.stored_filename"',
      "<div class=\"attachment-meta\" data-session-replay-mask>",
      'class="muted small" data-session-replay-mask>{{ event.actor_email || "System" }}',
      'class="event-metadata" data-session-replay-mask',
    ],
  },
  {
    name: "super-admin and workspace account pages",
    path: "../pages/super/TenantAccounts.vue",
    snippets: [
      'data-session-replay-mask type="email"',
      'class="sa-notice" role="status" data-session-replay-mask',
    ],
  },
  {
    name: "workspace primary-admin directory",
    path: "../pages/super/Workspaces.vue",
    snippets: ["data-session-replay-mask>{{ workspace.primary_admin_email || 'Not assigned' }}"],
  },
  {
    name: "super-admin roster",
    path: "../pages/super/SuperAdmins.vue",
    snippets: [
      "data-session-replay-mask>{{ admin.auth_email }}",
      'class="toast-body" data-session-replay-mask',
    ],
  },
  {
    name: "workspace-admin roster",
    path: "../pages/super/Admins.vue",
    snippets: ["data-session-replay-mask>{{ a.auth_email }}"],
  },
  {
    name: "tenant account roster",
    path: "../pages/workspace/admin/Accounts.vue",
    snippets: ["data-session-replay-mask>{{ account.auth_email }}"],
  },
  {
    name: "workspace admin roster and primary admin dialog",
    path: "../pages/workspace/admin/Admins.vue",
    snippets: [
      "<span data-session-replay-mask>{{ admin.auth_email }}</span>",
      'class="primary-admin-email-value" data-session-replay-mask',
    ],
  },
  {
    name: "tenant access picker",
    path: "../components/app/TenantAccessPicker.vue",
    snippets: ["<span data-session-replay-mask>{{ account.auth_email }}</span>"],
  },
  {
    name: "item notes and account labels",
    path: "../pages/workspace/admin/Items.vue",
    snippets: [
      'class="item-notes-cell" data-session-replay-mask',
      'class="scoped-accounts-cell" data-session-replay-mask',
    ],
  },
  {
    name: "status and import notes",
    path: "../pages/workspace/admin/ItemStatusTracking.vue",
    snippets: [
      '<td data-session-replay-mask>{{ item.notes || "-" }}</td>',
      '<td data-session-replay-mask>{{ event.note || "-" }}</td>',
    ],
  },
  {
    name: "item import preview notes",
    path: "../pages/workspace/admin/ItemImport.vue",
    snippets: ['<td data-session-replay-mask>{{ row.notes || "-" }}</td>'],
  },
  {
    name: "customer details",
    path: "../pages/super/Customers.vue",
    snippets: [
      "data-session-replay-mask>{{ customer.organization }}",
      "data-session-replay-mask>{{ selectedCustomer.name }}",
      "data-session-replay-mask>{{ selectedCustomer.organization }}",
      "data-session-replay-mask>{{ selectedCustomer.reply_email }}",
      'data-session-replay-mask>{{ selectedCustomer.details || "-" }}',
    ],
  },
  {
    name: "sales-lead details",
    path: "../pages/super/SalesLeads.vue",
    snippets: [
      "data-session-replay-mask>{{ lead.name }}",
      "data-session-replay-mask>{{ lead.organization }}",
      "data-session-replay-mask>{{ lead.reply_email }}",
      "data-session-replay-mask>{{ selectedLead.name }}",
      "data-session-replay-mask>{{ selectedLead.organization }}",
      "data-session-replay-mask>{{ selectedLead.reply_email }}",
      'data-session-replay-mask>{{ selectedLead.details || "-" }}',
    ],
  },
  {
    name: "privileged actor activity",
    path: "../pages/super/SuperAdminHome.vue",
    snippets: [
      'v-if="item.actor_email" data-session-replay-mask>{{ item.actor_email }}',
    ],
  },
  {
    name: "super-admin profile and settings",
    path: "../components/superadmin/SuperAdminProfileMenu.vue",
    snippets: ['class="sa-profile-name" data-session-replay-mask'],
  },
  {
    name: "super-admin settings email",
    path: "../pages/super/Settings.vue",
    snippets: ['<strong data-session-replay-mask>{{ auth.email || "your account email" }}'],
  },
  {
    name: "workspace admin home email",
    path: "../pages/workspace/admin/AdminHome.vue",
    snippets: ["<span data-session-replay-mask>{{ adminEmail }}</span>"],
  },
  {
    name: "account security secrets",
    path: "../pages/AccountSecurity.vue",
    snippets: [
      '<img\n          v-if="qrCode"\n          data-session-replay-mask',
      '<details data-session-replay-mask>',
      '<code data-session-replay-mask>{{ totpUri }}</code>',
      '<div v-if="backupCodes.length" class="backup-codes" data-session-replay-mask role="status">',
      '<code v-for="code in backupCodes" :key="code" data-session-replay-mask>{{ code }}</code>',
    ],
  },
] as const;

describe("session replay sensitive-text coverage", () => {
  it.each(coverageCases)("keeps $name covered by the replay mask", ({ path, snippets }) => {
    const template = readFileSync(new URL(path, import.meta.url), "utf8").split("<script setup")[0] ?? "";

    for (const snippet of snippets) {
      expect(template, `${path} is missing replay masking for ${snippet}`).toContain(snippet);
    }
  });
});
