<template>
  <div class="page">
    <h1>Super Admin</h1>
    <p>Platform management</p>
    <nav class="nav">
      <RouterLink to="/super-admin/tenants">Tenants</RouterLink>
      <RouterLink to="/super-admin/admins">Tenant Admins</RouterLink>
    </nav>
    <button type="button" class="link" @click="handleSignOut">Sign out</button>
  </div>
</template>

<script setup lang="ts">
import { RouterLink } from "vue-router";
import { useRouter } from "vue-router";
import { signOut } from "../../services/authService";

const router = useRouter();
const handleSignOut = async () => {
  await signOut();
  await router.push("/");
};
</script>
