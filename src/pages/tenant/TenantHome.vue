<template>
  <div class="page">
    <h1>Borrower</h1>
    <p>Borrower home</p>
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
import { getPostSignOutUrl, signOut } from "../../services/authService";

const router = useRouter();
const handleSignOut = async () => {
  const nextUrl = getPostSignOutUrl();
  await signOut();
  if (nextUrl.startsWith("http")) {
    window.location.assign(nextUrl);
    return;
  }
  await router.push(nextUrl);
};
</script>
