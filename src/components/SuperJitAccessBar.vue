<template>
  <section class="sa-panel jit-bar">
    <div v-if="activeJitSession" class="jit-bar-row">
      <div>
        <span
          class="sa-tag"
          :class="activeJitSession.ticket.scope === 'break_glass' ? 'critical' : 'ok'"
        >
          {{ activeJitSession.ticket.scope === 'break_glass' ? 'BREAK-GLASS ACTIVE' : 'JIT READ-ONLY ACTIVE' }}
        </span>
        <strong class="jit-workspace">
          {{ workspaceNameById.get(activeJitSession.ticket.workspace_id) || activeJitSession.ticket.workspace_id }}
        </strong>
        <span class="muted">
          Expires in <strong>{{ remainingLabel }}</strong>
          <template v-if="activeJitSession.ticket.external_ticket_id">
            &middot; Ref: {{ activeJitSession.ticket.external_ticket_id }}
          </template>
        </span>
      </div>
      <div class="sa-table-row-actions">
        <button
          v-if="activeJitSession.ticket.scope !== 'break_glass'"
          type="button"
          class="sa-btn danger"
          @click="openModal('break_glass')"
        >
          Escalate to Break-Glass
        </button>
        <button
          type="button"
          class="sa-btn"
          :disabled="isSubmitting"
          @click="handleRevoke"
        >
          Revoke Access Now
        </button>
      </div>
    </div>
    <div v-else class="jit-bar-row">
      <div>
        <span class="sa-tag info">METADATA-ONLY MODE</span>
        <span class="muted">
          No standing access to tenant records or decrypted borrower payloads. Request a scoped JIT ticket for one workspace.
        </span>
      </div>
      <div class="sa-table-row-actions">
        <button type="button" class="sa-btn primary" @click="openModal('read_only')">
          Request JIT Support (Read-Only)
        </button>
        <button type="button" class="sa-btn danger" @click="openModal('break_glass')">
          Emergency Break-Glass
        </button>
      </div>
    </div>

    <p v-if="errorMessage" class="sa-error">{{ errorMessage }}</p>

    <div v-if="modalMode" class="jit-modal-backdrop" role="dialog" aria-modal="true">
      <div class="jit-modal">
        <h3>{{ modalMode === 'break_glass' ? 'Invoke Emergency Break-Glass Access' : 'Request Read-Only JIT Support Ticket' }}</h3>
        <p class="muted">
          {{
            modalMode === 'break_glass'
              ? 'Break-glass grants temporary write and decrypt access to one workspace and fires immediate synchronous security alerts.'
              : 'Grants temporary read-only access to one workspace. Mutations remain blocked.'
          }}
        </p>
        <form class="form" @submit.prevent="handleSubmit">
          <label>
            Target Workspace
            <select v-model="selectedWorkspaceId" required>
              <option value="">Select workspace</option>
              <option v-for="ws in workspaces" :key="ws.id" :value="ws.id">{{ ws.name }}</option>
            </select>
          </label>
          <label>
            Duration (minutes, 1-60)
            <input v-model.number="ttlMinutes" type="number" min="1" max="60" required />
          </label>
          <template v-if="modalMode === 'read_only'">
            <label>
              Support Ticket ID
              <input v-model="externalTicketId" type="text" maxlength="128" placeholder="e.g. SUP-1024" required />
            </label>
            <label>
              Reason
              <textarea v-model="reason" rows="3" minlength="3" maxlength="1000" required />
            </label>
          </template>
          <template v-else>
            <label>
              Justification (required, min 10 chars)
              <textarea v-model="justification" rows="3" minlength="10" maxlength="2000" required />
            </label>
            <label>
              Acknowledged By (required)
              <input v-model="acknowledgedBy" type="text" minlength="2" maxlength="256" placeholder="Name or role approving break-glass" required />
            </label>
            <label>
              Incident ID (optional)
              <input v-model="incidentId" type="text" maxlength="128" placeholder="e.g. INC-42 (leave blank if not an incident)" />
            </label>
            <label>
              Support Ticket ID (optional)
              <input v-model="externalTicketId" type="text" maxlength="128" placeholder="e.g. SUP-1024" />
            </label>
          </template>
          <div class="sa-table-row-actions">
            <button
              type="submit"
              class="sa-btn"
              :class="modalMode === 'break_glass' ? 'danger' : 'primary'"
              :disabled="isSubmitting"
            >
              {{ isSubmitting ? 'Submitting...' : modalMode === 'break_glass' ? 'Confirm Break-Glass & Alert Security' : 'Issue JIT Ticket' }}
            </button>
            <button type="button" class="sa-btn" :disabled="isSubmitting" @click="closeModal">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import {
  invokeBreakGlassAccess,
  requestJitSupportTicket,
  revokeJitSupportTicket,
} from "../services/superOps/jitAccess";
import {
  onJitSessionCleared,
  useActiveJitSession,
  type JitTicketScope,
} from "../store/jitAccessState";
import { toUserFacingErrorMessage } from "../services/appErrors";

const props = defineProps<{
  workspaces: Array<{ id: string; name: string }>;
  defaultWorkspaceId?: string;
}>();

const emit = defineEmits<{
  (event: "ticket-granted", payload: { workspaceId: string; scope: JitTicketScope }): void;
  (event: "ticket-cleared"): void;
}>();

const { activeJitSession } = useActiveJitSession();
const modalMode = ref<null | JitTicketScope>(null);
const selectedWorkspaceId = ref("");
const ttlMinutes = ref(15);
const externalTicketId = ref("");
const reason = ref("");
const justification = ref("");
const acknowledgedBy = ref("");
const incidentId = ref("");
const isSubmitting = ref(false);
const errorMessage = ref("");
const nowMs = ref(Date.now());
let tickTimer: ReturnType<typeof setInterval> | null = null;
let unsubscribeCleared: (() => void) | null = null;

const workspaceNameById = computed(
  () => new Map(props.workspaces.map((ws) => [ws.id, ws.name])),
);

const remainingLabel = computed(() => {
  const session = activeJitSession.value;
  if (!session) return "00:00";
  const diffSec = Math.max(0, Math.floor((Date.parse(session.ticket.expires_at) - nowMs.value) / 1000));
  const mins = Math.floor(diffSec / 60);
  const secs = diffSec % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
});

const openModal = (mode: JitTicketScope) => {
  errorMessage.value = "";
  modalMode.value = mode;
  selectedWorkspaceId.value = props.defaultWorkspaceId && props.defaultWorkspaceId !== "all"
    ? props.defaultWorkspaceId
    : activeJitSession.value?.ticket.workspace_id || "";
  ttlMinutes.value = 15;
};

const closeModal = () => {
  modalMode.value = null;
  errorMessage.value = "";
};

const handleSubmit = async () => {
  if (!modalMode.value || !selectedWorkspaceId.value) return;
  isSubmitting.value = true;
  errorMessage.value = "";
  try {
    if (modalMode.value === "read_only") {
      const res = await requestJitSupportTicket({
        workspace_id: selectedWorkspaceId.value,
        reason: reason.value.trim(),
        external_ticket_id: externalTicketId.value.trim(),
        ttl_minutes: ttlMinutes.value,
      });
      reason.value = "";
      externalTicketId.value = "";
      modalMode.value = null;
      emit("ticket-granted", {
        workspaceId: res.ticket.workspace_id,
        scope: res.ticket.scope,
      });
    } else {
      const res = await invokeBreakGlassAccess({
        workspace_id: selectedWorkspaceId.value,
        justification: justification.value.trim(),
        acknowledged_by: acknowledgedBy.value.trim(),
        incident_id: incidentId.value.trim() || null,
        external_ticket_id: externalTicketId.value.trim() || null,
        ttl_minutes: ttlMinutes.value,
      });
      justification.value = "";
      acknowledgedBy.value = "";
      incidentId.value = "";
      externalTicketId.value = "";
      modalMode.value = null;
      emit("ticket-granted", {
        workspaceId: res.ticket.workspace_id,
        scope: res.ticket.scope,
      });
    }
  } catch (err) {
    errorMessage.value = toUserFacingErrorMessage(err, "Unable to obtain JIT ticket.");
  } finally {
    isSubmitting.value = false;
  }
};

const handleRevoke = async () => {
  const session = activeJitSession.value;
  if (!session) return;
  isSubmitting.value = true;
  errorMessage.value = "";
  try {
    await revokeJitSupportTicket(session.ticket.id, "Manual super-admin revocation");
    emit("ticket-cleared");
  } catch (err) {
    errorMessage.value = toUserFacingErrorMessage(err, "Unable to revoke JIT ticket.");
  } finally {
    isSubmitting.value = false;
  }
};

onMounted(() => {
  tickTimer = setInterval(() => {
    nowMs.value = Date.now();
  }, 1000);
  unsubscribeCleared = onJitSessionCleared(() => {
    emit("ticket-cleared");
  });
});

onUnmounted(() => {
  if (tickTimer !== null) clearInterval(tickTimer);
  unsubscribeCleared?.();
});
</script>

<style scoped>
.jit-bar-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}
.jit-workspace {
  margin: 0 0.5rem;
}
.jit-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  padding: 1rem;
}
.jit-modal {
  background: var(--surface, #fff);
  border: 1px solid var(--border, #dbe3ec);
  border-radius: 12px;
  max-width: 520px;
  width: 100%;
  padding: 1.5rem;
  box-shadow: 0 12px 36px rgba(15, 23, 42, 0.25);
}
</style>
