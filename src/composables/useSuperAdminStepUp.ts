import { ref } from "vue";
import { toUserFacingErrorMessage } from "../services/appErrors";
import { verifySuperAdminPassword } from "../services/superOps/sessions";

type StepUpRequest = {
  title: string;
  message: string;
  confirmLabel?: string;
};

type StepUpPayload = {
  superPassword: string;
  confirmPhrase: string;
};

export const useSuperAdminStepUp = (
  onError: (cause: unknown) => void,
) => {
  const visible = ref(false);
  const title = ref("Confirm Super Admin Action");
  const message = ref("");
  const confirmLabel = ref("Confirm");
  const error = ref("");
  const isSubmitting = ref(false);
  let pendingAction: (() => Promise<void>) | null = null;

  const request = (options: StepUpRequest, action: () => Promise<void>) => {
    if (visible.value || isSubmitting.value) return;
    title.value = options.title;
    message.value = options.message;
    confirmLabel.value = options.confirmLabel ?? "Confirm";
    error.value = "";
    pendingAction = action;
    visible.value = true;
  };

  const cancel = () => {
    if (isSubmitting.value) return;
    visible.value = false;
    error.value = "";
    pendingAction = null;
  };

  const confirm = async (payload: StepUpPayload) => {
    if (!pendingAction || isSubmitting.value) return;
    const action = pendingAction;
    isSubmitting.value = true;
    try {
      try {
        await verifySuperAdminPassword(payload.superPassword);
      } catch (cause) {
        error.value = toUserFacingErrorMessage(cause, "Unable to verify your super admin password.");
        return;
      }
      visible.value = false;
      error.value = "";
      pendingAction = null;
      await action();
    } catch (cause) {
      onError(cause);
    } finally {
      isSubmitting.value = false;
    }
  };

  return {
    visible,
    title,
    message,
    confirmLabel,
    error,
    isSubmitting,
    request,
    cancel,
    confirm,
  };
};
