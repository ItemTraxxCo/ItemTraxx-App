import { computed, onMounted, ref, watch } from "vue";
import type { RouteLocationNormalizedLoaded } from "vue-router";
import {
  hasCompletedOnboarding,
  markOnboardingCompleted,
  resetOnboarding,
  type TenantOnboardingRole,
} from "../services/onboardingService";

type OnboardingAuthState = {
  isInitialized: boolean;
  isAuthenticated: boolean;
  role: string | null;
};

export const useOnboarding = (auth: OnboardingAuthState, route: RouteLocationNormalizedLoaded) => {
  const visible = ref(false);
  const role = ref<TenantOnboardingRole>("tenant_user");
  const variant = ref<"tenant_checkout" | "tenant_admin">("tenant_checkout");
  const evaluationDone = ref(false);

  const currentRole = computed<TenantOnboardingRole | null>(() => {
    if (!auth.isAuthenticated) return null;
    return auth.role === "tenant_user" || auth.role === "tenant_admin" ? auth.role : null;
  });
  const isOnTenantRoute = computed(() => route.path.startsWith("/tenant"));
  const canReplay = computed(() => !!currentRole.value && isOnTenantRoute.value);

  const evaluate = () => {
    const nextRole = currentRole.value;
    if (!auth.isInitialized || !auth.isAuthenticated || !nextRole) {
      visible.value = false;
      evaluationDone.value = false;
      return;
    }
    if (!isOnTenantRoute.value) {
      visible.value = false;
      return;
    }
    role.value = nextRole;
    variant.value = route.path.startsWith("/tenant/admin") ? "tenant_admin" : "tenant_checkout";
    if (evaluationDone.value) return;
    if (!hasCompletedOnboarding(nextRole)) visible.value = true;
    evaluationDone.value = true;
  };

  const open = () => {
    if (!currentRole.value) return;
    resetOnboarding(currentRole.value);
    role.value = currentRole.value;
    variant.value = route.path.startsWith("/tenant/admin") ? "tenant_admin" : "tenant_checkout";
    evaluationDone.value = true;
    visible.value = true;
  };

  const complete = () => {
    markOnboardingCompleted(role.value);
    evaluationDone.value = true;
    visible.value = false;
  };

  watch(() => [route.path, auth.isInitialized, auth.isAuthenticated, auth.role] as const, evaluate);
  onMounted(evaluate);

  return {
    canReplay,
    complete,
    currentRole,
    evaluate,
    open,
    role,
    variant,
    visible,
  };
};
