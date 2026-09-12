<template>
  <div class="page">
    <div class="sa-toolbar">
      <div>
        <RouterLink to="/super-admin" class="sa-back-link">&larr; Back to Control Center</RouterLink>
        <h1 class="sa-toolbar-title">Support Requests</h1>
        <p class="sa-toolbar-sub">Review support submissions, attachments, and follow-up context from the contact support form.</p>
      </div>
    </div>

    <div class="sa-stat-strip" aria-label="Support request summary">
      <div v-for="option in statusOptions" :key="option.value" class="sa-stat">
        <div class="n">{{ countByStatus(option.value) }}</div>
        <div class="l">{{ option.label }}</div>
      </div>
    </div>

    <section class="sa-panel">
      <div class="sa-filters">
        <label>
          Search
          <input
            v-model.trim="search"
            type="text"
            placeholder="Search requester, email, subject, or message"
            @keyup.enter="loadRequests"
          />
        </label>
        <label>
          Status
          <select v-model="statusFilter">
            <option value="">All statuses</option>
            <option v-for="option in statusOptions" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
        </label>
        <button class="sa-btn" type="button" :disabled="isLoading" @click="loadRequests">
          {{ isLoading ? "Loading..." : "Search" }}
        </button>
      </div>

      <p v-if="error" class="sa-error">{{ error }}</p>
      <p v-else-if="isLoading" class="muted">Loading support requests...</p>

      <div v-else class="sa-table-wrap">
        <table class="sa-table">
          <thead>
            <tr>
              <th>Requester</th>
              <th>Category</th>
              <th>Subject</th>
              <th>Status</th>
              <th>Created</th>
              <th>Open</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="request in requests" :key="request.id">
              <td>
                <div>{{ request.requester_name }}</div>
                <div class="muted small">{{ request.reply_email }}</div>
              </td>
              <td>{{ categoryLabel(request.category) }}</td>
              <td>{{ request.subject }}</td>
              <td>
                <span
                  class="sa-tag"
                  :class="statusClass(request.status) === 'status-resolved' ? 'ok' : statusClass(request.status) === 'status-spam' ? 'info' : 'warn'"
                >
                  {{ statusLabel(request.status) }}
                </span>
              </td>
              <td>{{ formatDate(request.created_at) }}</td>
              <td>
                <div class="sa-table-row-actions">
                  <button class="sa-btn" type="button" @click="openRequest(request.id)">Details</button>
                </div>
              </td>
            </tr>
            <tr v-if="!requests.length">
              <td colspan="6" class="muted">No support requests found.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <div v-if="selectedRequest" class="sa-modal-backdrop" @click.self="closeRequest">
      <section class="sa-modal">
        <h2>Support Request Details</h2>
        <div class="modal-body">
          <div class="kv-row"><span>Requester</span><strong>{{ selectedRequest.requester_name }}</strong></div>
          <div class="kv-row"><span>Reply Email</span><strong>{{ selectedRequest.reply_email }}</strong></div>
          <div class="kv-row"><span>Category</span><strong>{{ categoryLabel(selectedRequest.category) }}</strong></div>
          <div class="kv-row"><span>Created</span><strong>{{ formatDate(selectedRequest.created_at) }}</strong></div>
          <div class="kv-row">
            <span>Status</span>
            <select v-model="statusDraft" :disabled="isSaving">
              <option v-for="option in statusOptions" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </select>
          </div>
          <div class="kv-row">
            <span>Assigned</span>
            <strong>{{ selectedRequest.assigned_to_email || "Unassigned" }}</strong>
          </div>
          <div class="kv-row kv-row-details">
            <span>Subject</span>
            <p>{{ selectedRequest.subject }}</p>
          </div>
          <div class="kv-row kv-row-details">
            <span>Message</span>
            <p>{{ selectedRequest.message }}</p>
          </div>
          <div class="kv-row kv-row-details">
            <span>Internal Notes</span>
            <textarea
              v-model="notesDraft"
              rows="5"
              maxlength="4000"
              :disabled="isSaving"
              placeholder="Add internal notes for this support request."
            />
          </div>
        </div>

        <section class="modal-section">
          <div class="section-row">
            <h3>Attachments</h3>
            <span class="muted">{{ selectedRequest.attachments.length }} file(s)</span>
          </div>
          <div v-if="selectedRequest.attachments.length" class="attachment-grid">
            <article
              v-for="attachment in selectedRequest.attachments"
              :key="attachment.id"
              class="attachment-card"
            >
              <a
                v-if="safeExternalUrl(attachment.signed_url)"
                :href="safeExternalUrl(attachment.signed_url)"
                target="_blank"
                rel="noreferrer"
                class="attachment-preview-link"
              >
                <img
                  :src="safeExternalUrl(attachment.signed_url)"
                  :alt="attachment.original_filename || attachment.stored_filename"
                  class="attachment-preview"
                />
              </a>
              <div class="attachment-meta">
                <strong>{{ attachment.original_filename || attachment.stored_filename }}</strong>
                <span class="muted small">{{ formatBytes(attachment.size_bytes) }} · {{ attachment.content_type }}</span>
              </div>
            </article>
          </div>
          <p v-else class="muted">No attachments.</p>
        </section>

        <section class="modal-section">
          <div class="section-row">
            <h3>Activity</h3>
          </div>
          <ul class="event-list">
            <li v-for="event in selectedRequest.events" :key="event.id" class="event-item">
              <div class="event-header">
                <strong>{{ event.event_type }}</strong>
                <span class="muted">{{ formatDate(event.created_at) }}</span>
              </div>
              <div class="muted small">{{ event.actor_email || "System" }}</div>
              <pre v-if="event.metadata" class="event-metadata">{{ formatEventMetadata(event.metadata) }}</pre>
            </li>
            <li v-if="!selectedRequest.events.length" class="muted">No events yet.</li>
          </ul>
        </section>

        <p v-if="modalError" class="sa-error">{{ modalError }}</p>
        <p v-if="success" class="sa-notice">{{ success }}</p>

        <div class="panel-actions">
          <button class="sa-btn primary" type="button" :disabled="isSaving" @click="saveRequest">
            {{ isSaving ? "Saving..." : "Save changes" }}
          </button>
          <button
            class="sa-btn"
            type="button"
            :disabled="isSaving || selectedRequest.assigned_to_email !== null"
            @click="assignToMe"
          >
            Assign to me
          </button>
          <button
            class="sa-btn"
            type="button"
            :disabled="isSaving || selectedRequest.assigned_to_email === null"
            @click="clearAssignment"
          >
            Clear assignment
          </button>
          <button class="sa-btn" type="button" @click="copyEmail(selectedRequest.reply_email)">Copy email</button>
          <button class="sa-btn" type="button" @click="closeRequest">Close</button>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { toUserFacingErrorMessage } from "../../services/appErrors";
import {
  getSupportRequest,
  listSupportRequests,
  updateSupportRequest,
  type SupportRequestDetail,
  type SupportRequestListItem,
  type SupportRequestStatus,
} from "../../services/superOps/support";
import { safeExternalUrl } from "../../utils/safeUrl";

const statusOptions: Array<{ value: SupportRequestStatus; label: string }> = [
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In progress" },
  { value: "resolved", label: "Resolved" },
  { value: "spam", label: "Spam" },
];

const requests = ref<SupportRequestListItem[]>([]);
const search = ref("");
const statusFilter = ref<SupportRequestStatus | "">("");
const isLoading = ref(false);
const isSaving = ref(false);
const error = ref("");
const modalError = ref("");
const success = ref("");
const selectedRequest = ref<SupportRequestDetail | null>(null);
const statusDraft = ref<SupportRequestStatus>("open");
const notesDraft = ref("");

const countByStatus = (status: SupportRequestStatus) =>
  requests.value.filter((item) => item.status === status).length;

const formatDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const categoryLabel = (value: SupportRequestListItem["category"]) => {
  switch (value) {
    case "bug":
      return "Bug";
    case "billing":
      return "Billing";
    case "access":
      return "Access";
    case "feature":
      return "Feature";
    case "privacy":
      return "Privacy";
    case "security":
      return "Security";
    case "other":
      return "Other";
    default:
      return "General";
  }
};

const statusLabel = (value: SupportRequestStatus) => {
  switch (value) {
    case "in_progress":
      return "In progress";
    case "resolved":
      return "Resolved";
    case "spam":
      return "Spam";
    default:
      return "Open";
  }
};

const statusClass = (value: SupportRequestStatus) => {
  switch (value) {
    case "in_progress":
      return "status-in_progress";
    case "resolved":
      return "status-resolved";
    case "spam":
      return "status-spam";
    default:
      return "status-open";
  }
};

const formatBytes = (value: number) => {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
};

const formatEventMetadata = (value: Record<string, unknown>) => JSON.stringify(value, null, 2);

const syncDrafts = (request: SupportRequestDetail) => {
  statusDraft.value = request.status;
  notesDraft.value = request.internal_notes || "";
};

const loadRequests = async () => {
  isLoading.value = true;
  error.value = "";
  success.value = "";
  try {
    const response = await listSupportRequests({
      search: search.value,
      status: statusFilter.value,
      limit: 200,
    });
    requests.value = response.requests ?? [];
  } catch (err) {
    error.value = toUserFacingErrorMessage(err, "Unable to load support requests.");
  } finally {
    isLoading.value = false;
  }
};

const refreshSelectedRequest = async (supportRequestId: string) => {
  const response = await getSupportRequest({ support_request_id: supportRequestId });
  selectedRequest.value = response.request;
  syncDrafts(response.request);
  requests.value = requests.value.map((request) =>
    request.id === response.request.id
      ? {
          id: response.request.id,
          requester_name: response.request.requester_name,
          reply_email: response.request.reply_email,
          subject: response.request.subject,
          category: response.request.category,
          status: response.request.status,
          created_at: response.request.created_at,
          updated_at: response.request.updated_at,
          assigned_to: response.request.assigned_to,
        }
      : request,
  );
};

const openRequest = async (supportRequestId: string) => {
  modalError.value = "";
  success.value = "";
  selectedRequest.value = null;
  try {
    await refreshSelectedRequest(supportRequestId);
  } catch (err) {
    error.value = toUserFacingErrorMessage(err, "Unable to load support request.");
  }
};

const closeRequest = () => {
  selectedRequest.value = null;
  modalError.value = "";
  success.value = "";
};

const saveRequest = async () => {
  if (!selectedRequest.value) return;
  isSaving.value = true;
  modalError.value = "";
  success.value = "";
  try {
    const response = await updateSupportRequest({
      support_request_id: selectedRequest.value.id,
      status: statusDraft.value,
      internal_notes: notesDraft.value,
    });
    selectedRequest.value = response.request;
    syncDrafts(response.request);
    await loadRequests();
    success.value = "Support request updated.";
  } catch (err) {
    modalError.value = toUserFacingErrorMessage(err, "Unable to update support request.");
  } finally {
    isSaving.value = false;
  }
};

const assignToMe = async () => {
  if (!selectedRequest.value) return;
  isSaving.value = true;
  modalError.value = "";
  success.value = "";
  try {
    const response = await updateSupportRequest({
      support_request_id: selectedRequest.value.id,
      assign_to_me: true,
    });
    selectedRequest.value = response.request;
    syncDrafts(response.request);
    await loadRequests();
    success.value = "Support request assigned.";
  } catch (err) {
    modalError.value = toUserFacingErrorMessage(err, "Unable to assign support request.");
  } finally {
    isSaving.value = false;
  }
};

const clearAssignment = async () => {
  if (!selectedRequest.value) return;
  isSaving.value = true;
  modalError.value = "";
  success.value = "";
  try {
    const response = await updateSupportRequest({
      support_request_id: selectedRequest.value.id,
      clear_assignment: true,
    });
    selectedRequest.value = response.request;
    syncDrafts(response.request);
    await loadRequests();
    success.value = "Support request unassigned.";
  } catch (err) {
    modalError.value = toUserFacingErrorMessage(err, "Unable to update assignment.");
  } finally {
    isSaving.value = false;
  }
};

const copyEmail = async (value: string) => {
  try {
    await navigator.clipboard.writeText(value);
    success.value = "Reply email copied.";
  } catch {
    modalError.value = "Unable to copy email.";
  }
};

onMounted(() => {
  void loadRequests();
});
</script>

<style scoped>
.small {
  font-size: 0.9rem;
}

.panel-actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 1rem;
  flex-wrap: wrap;
}

.modal-body {
  display: grid;
  gap: 0.85rem;
  margin-top: 1rem;
}

.kv-row {
  display: grid;
  grid-template-columns: 140px minmax(0, 1fr);
  gap: 1rem;
  align-items: start;
}

.kv-row-details p,
.kv-row-details textarea {
  margin: 0;
  width: 100%;
}

.modal-section {
  margin-top: 1.5rem;
}

.section-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  margin-bottom: 0.75rem;
}

.attachment-grid {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
}

.attachment-card {
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  background: var(--surface);
}

.attachment-preview-link {
  display: block;
  background: var(--surface-2);
}

.attachment-preview {
  display: block;
  width: 100%;
  aspect-ratio: 4 / 3;
  object-fit: cover;
}

.attachment-meta {
  display: grid;
  gap: 0.3rem;
  padding: 0.85rem;
}

.event-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.85rem;
}

.event-item {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0.9rem 1rem;
  background: var(--surface);
}

.event-header {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  align-items: center;
}

.event-metadata {
  margin: 0.6rem 0 0;
  padding: 0.75rem;
  border-radius: 6px;
  background: var(--surface-3);
  color: var(--text);
  overflow: auto;
  font-size: 0.85rem;
}

@media (max-width: 760px) {
  .kv-row {
    grid-template-columns: 1fr;
    gap: 0.35rem;
  }
}
</style>
