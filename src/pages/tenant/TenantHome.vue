<template>
  <div class="page">
    <h1>User</h1>
    <p>User home</p>
    <nav class="nav">
      <RouterLink to="/tenant/checkout">Checkout</RouterLink>
      <RouterLink to="/tenant/admin">Admin</RouterLink>
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
