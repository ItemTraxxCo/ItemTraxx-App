<template>
  <main class="page admin-shell">
    <RouterLink to="/admin">Return to admin panel</RouterLink>
    <h1>Tenant Accounts</h1>
    <section class="card">
      <h2>Add Tenant Account</h2>
      <form class="add-account-form" @submit.prevent="create">
        <input v-model="email" type="email" autocomplete="email" placeholder="Email address" required />
        <button :disabled="busy">Create and send setup link</button>
      </form>
      <p v-if="message">{{ message }}</p>
    </section>
    <section class="card">
      <h2>Accounts</h2>
      <div class="table-wrap">
        <table class="table accounts-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="account in accounts" :key="account.id">
              <td>{{ account.auth_email }}</td>
              <td>{{ account.is_active ? "Active" : "Suspended" }}</td>
              <td class="accounts-actions">
                <button type="button" @click="toggle(account)">
                  {{ account.is_active ? "Suspend" : "Restore" }}
                </button>
                <button type="button" @click="reset(account.id)">Send password reset</button>
                <button type="button" @click="remove(account.id)">Remove</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </main>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import {
  createTenantAccount,
  listTenantAccounts,
  removeTenantAccount,
  sendTenantAccountReset,
  setTenantAccountStatus,
  type TenantAccount,
} from "../../../services/workspaceAdminManageService";

const accounts = ref<TenantAccount[]>([]);
const email = ref("");
const message = ref("");
const busy = ref(false);

const load = async () => {
  accounts.value = await listTenantAccounts();
};

const create = async () => {
  busy.value = true;
  try {
    await createTenantAccount(email.value);
    email.value = "";
    message.value = "Tenant Account created and setup email requested.";
    await load();
  } finally {
    busy.value = false;
  }
};

const toggle = async (account: TenantAccount) => {
  await setTenantAccountStatus(account.id, !account.is_active);
  await load();
};

const reset = async (id: string) => {
  await sendTenantAccountReset(id);
  message.value = "Password reset requested.";
};

const remove = async (id: string) => {
  if (confirm("Remove this Tenant Account? Existing records are retained.")) {
    await removeTenantAccount(id);
    await load();
  }
};

onMounted(() => void load());
</script>

<style scoped>
.add-account-form {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  align-items: flex-start;
}

.accounts-table th:nth-child(1),
.accounts-table td:nth-child(1) {
  width: 45%;
}

.accounts-table th:nth-child(2),
.accounts-table td:nth-child(2) {
  width: 15%;
}

.accounts-table th:nth-child(3),
.accounts-table td:nth-child(3) {
  width: 40%;
}

.accounts-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
}
</style>
