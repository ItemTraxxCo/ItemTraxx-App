<template>
  <AdminHome v-if="isIndividualAccount" />
  <Account v-else />
</template>

<script setup lang="ts">
import { computed } from "vue";
import { getAuthState } from "../../store/authState";
import Account from "./Account.vue";
import AdminHome from "./admin/AdminHome.vue";

const auth = getAuthState();
const isIndividualAccount = computed(() => auth.role === "individual_account");
</script>
