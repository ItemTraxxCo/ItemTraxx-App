import { computed, ref } from "vue";

export type CheckoutRetryReason = "network" | "server" | "rate_limit";
export type CheckoutRetryAction = "checkout" | "return" | "transaction" | "offline_sync";

export type CheckoutRetryStatus =
  | {
    id: string;
    phase: "waiting" | "retrying";
    action: CheckoutRetryAction;
    reason: CheckoutRetryReason;
    attempt: number;
    maxAttempts: number;
    secondsRemaining: number;
  }
  | {
    id: string;
    phase: "saved";
    action: CheckoutRetryAction;
    itemCount: number;
  };

const statusesById = new Map<string, CheckoutRetryStatus>();
const statuses = ref<CheckoutRetryStatus[]>([]);
let statusSequence = 0;

export const activeCheckoutRetryStatus = computed(() =>
  statuses.value[statuses.value.length - 1] ?? null
);

const publishStatuses = () => {
  statuses.value = [...statusesById.values()];
};

export const createCheckoutRetryStatusId = () =>
  `checkout-retry-${Date.now()}-${++statusSequence}`;

export const setCheckoutRetryStatus = (status: CheckoutRetryStatus) => {
  statusesById.delete(status.id);
  statusesById.set(status.id, status);
  publishStatuses();
};

export const clearCheckoutRetryStatus = (
  id: string,
  expectedPhase?: CheckoutRetryStatus["phase"],
) => {
  const current = statusesById.get(id);
  if (!current || (expectedPhase && current.phase !== expectedPhase)) return;
  statusesById.delete(id);
  publishStatuses();
};

export const showCheckoutSavedForSync = (
  status: Extract<CheckoutRetryStatus, { phase: "saved" }>,
  durationMs = 8_000,
) => {
  setCheckoutRetryStatus(status);
  globalThis.setTimeout(() => {
    if (statusesById.get(status.id) === status) {
      clearCheckoutRetryStatus(status.id, "saved");
    }
  }, durationMs);
};

export const MAX_CHECKOUT_ATTEMPTS = 3;
export const MAX_RATE_LIMIT_RETRIES = 1;

export const getCheckoutRetryDelayMs = (
  retryAttempt: number,
  reason: CheckoutRetryReason,
  retryAfterSeconds?: number | null,
) => {
  if (reason === "rate_limit") {
    const seconds = typeof retryAfterSeconds === "number" && Number.isFinite(retryAfterSeconds)
      ? Math.max(1, Math.min(300, Math.ceil(retryAfterSeconds)))
      : 60;
    return seconds * 1_000;
  }

  const exponentialMs = Math.min(8_000, 1_000 * 2 ** Math.max(0, retryAttempt - 2));
  return Math.min(8_000, Math.round(exponentialMs * (0.8 + Math.random() * 0.4)));
};

const isBrowserOnline = () =>
  typeof navigator === "undefined" || navigator.onLine !== false;

export const waitForCheckoutRetry = async (
  delayMs: number,
  onCountdown: (secondsRemaining: number) => void,
) => {
  const deadline = Date.now() + Math.max(0, delayMs);
  while (true) {
    if (!isBrowserOnline()) return false;
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) return isBrowserOnline();
    onCountdown(Math.ceil(remainingMs / 1_000));
    await new Promise<void>((resolve) => {
      globalThis.setTimeout(resolve, Math.min(1_000, remainingMs));
    });
  }
};
