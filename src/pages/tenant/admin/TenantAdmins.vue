<template>
  <div class="page">
    <h1>User Admins</h1>
    <p>Create user admin accounts for this user.</p>
        <p3> Ability to export user admin data to PDF and CSV coming soon.</p3>


    <div class="card">
      <h2>User Admins</h2>
      <p class="muted">To change user admin passwords, please contact support.</p>
      <p v-if="isLoading" class="muted">Loading admins...</p>
      <table v-else class="table">
        <thead>
          <tr>
            <th>Email</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="admin in admins" :key="admin.id">
            <td>{{ admin.auth_email ?? "Unknown" }}</td>
            <td>{{ formatDate(admin.created_at) }}</td>
          </tr>
          <tr v-if="admins.length === 0">
            <td colspan="2" class="muted">No tenant admins found.</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="card">
      <h2>Create Admin</h2>
      <p class="muted">Verify your password before creating a new admin.</p>
      <form class="form" @submit.prevent="handleVerify">
        <label>
          Current admin password
          <input
            v-model="currentPassword"
            type="password"
            placeholder="Enter your password"
          />
        </label>
        <div class="form-actions">
          <button type="submit" class="button-primary" :disabled="isVerifying">
            Verify password
          </button>
        </div>
      </form>

      <div v-if="isVerified" class="panel">
        <h3>Create new admin</h3>
        <form class="form" @submit.prevent="handleCreate">
          <label>
            New admin email
            <input v-model="email" type="email" placeholder="Email address" />
          </label>
          <label>
            New admin password
            <input v-model="password" type="password" placeholder="Password" />
          </label>
          <div class="form-actions">
            <button type="submit" class="button-primary" :disabled="isSubmitting">
              Create admin
            </button>
          </div>
        </form>
      </div>

      <p v-if="error" class="error">{{ error }}</p>
      <p v-if="success" class="success">{{ success }}</p>
    </div>

    <div class="admin-actions">
      <RouterLink class="link" to="/tenant/admin">Back to admin</RouterLink>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { RouterLink } from "vue-router";
import { sanitizeInput } from "../../../utils/inputSanitizer";
import { createTenantAdmin, fetchTenantAdmins, type TenantAdminSummary } from "../../../services/tenantAdminService";
import { logAdminAction } from "../../../services/auditLogService";
import { enforceAdminRateLimit } from "../../../services/rateLimitService";
import { supabase } from "../../../services/supabaseClient";
import { refreshAuthFromSession } from "../../../services/authService";
import { getAuthState } from "../../../store/authState";

const admins = ref<TenantAdminSummary[]>([]);
const isLoading = ref(false);
const email = ref("");
const password = ref("");
const currentPassword = ref("");
const isSubmitting = ref(false);
const isVerifying = ref(false);
const isVerified = ref(false);
const error = ref("");
const success = ref("");

const formatDate = (value: string | null) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
};

const loadAdmins = async () => {
  isLoading.value = true;
  try {
    admins.value = await fetchTenantAdmins();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Unable to load tenant admins.";
  } finally {
    isLoading.value = false;
  }
};

onMounted(() => {
  void loadAdmins();
});

const handleVerify = async () => {
  error.value = "";
  success.value = "";
  if (!currentPassword.value) {
    error.value = "Enter your password.";
    return;
  }

  isVerifying.value = true;
  try {
    const auth = getAuthState();
    if (!auth.email) {
      throw new Error("Unable to verify admin.");
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: auth.email,
      password: currentPassword.value,
    });

    if (signInError) {
      throw new Error("Invalid credentials.");
    }

    await refreshAuthFromSession();
    isVerified.value = true;
    success.value = "Password verified. You can create a new admin.";
  } catch (err) {
    isVerified.value = false;
    error.value = err instanceof Error ? err.message : "Invalid credentials.";
  } finally {
    isVerifying.value = false;
  }
};

const handleCreate = async () => {
  error.value = "";
  success.value = "";

  if (!isVerified.value) {
    error.value = "Verify your password first.";
    return;
  }

  const sanitizedEmail = sanitizeInput(email.value, { maxLen: 120 });
  if (sanitizedEmail.error) {
    error.value = sanitizedEmail.error;
    return;
  }

  if (!sanitizedEmail.value || !password.value) {
    error.value = "Enter all required fields.";
    return;
  }

  isSubmitting.value = true;
  try {
    await enforceAdminRateLimit();
    const result = await createTenantAdmin({
      new_email: sanitizedEmail.value,
      new_password: password.value,
      current_password: currentPassword.value,
    });

    await logAdminAction({
      action_type: "create_admin",
      entity_type: "tenant_admin",
      entity_id: result?.user_id ?? null,
      metadata: {
        email: sanitizedEmail.value,
      },
    });

    success.value = "Tenant admin created.";
    email.value = "";
    password.value = "";
    await loadAdmins();
  } catch (err) {
    error.value =
      err instanceof Error ? err.message : "Unable to create admin.";
  } finally {
    isSubmitting.value = false;
  }
};
</script>
