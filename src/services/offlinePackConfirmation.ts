export type OfflinePackSize = {
  itemCount: number;
  borrowerCount: number;
  totalRecords: number;
  maxRecords: number;
  maxBytes: number;
};

const WARNING_EVENT = "itemtraxx:offline-pack-large-warning";
export const OFFLINE_PACK_LARGE_WARNING_TIMEOUT_MS = 30_000;

let pendingResolver: ((confirmed: boolean) => void) | null = null;
let pendingTimeout: number | null = null;

export const requestLargeOfflinePackConfirmation = (size: OfflinePackSize) => {
  if (pendingResolver) return Promise.resolve(false);

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (confirmed: boolean) => {
      if (settled) return;
      settled = true;
      if (pendingTimeout !== null) window.clearTimeout(pendingTimeout);
      pendingTimeout = null;
      pendingResolver = null;
      resolve(confirmed);
    };
    pendingResolver = finish;
    pendingTimeout = window.setTimeout(() => finish(false), OFFLINE_PACK_LARGE_WARNING_TIMEOUT_MS);
    window.dispatchEvent(new CustomEvent<OfflinePackSize>(WARNING_EVENT, { detail: size }));
  });
};

export const resolveLargeOfflinePackConfirmation = (confirmed: boolean) => {
  pendingResolver?.(confirmed);
};

export const OFFLINE_PACK_LARGE_WARNING_EVENT = WARNING_EVENT;
