import { computed } from "vue";
import { getAuthState } from "../store/authState";

export const useManagerContext = () => {
  const auth = getAuthState();
  const isIndividualAccount = computed(() => auth.role === "individual_account");
  const managerRoot = computed(() => isIndividualAccount.value ? "/account" : "/admin");
  const managerPath = (suffix = "") => `${managerRoot.value}${suffix}`;

  return { isIndividualAccount, managerRoot, managerPath };
};
