export type PostHogIdentityAction =
  | { type: "reset" }
  | { type: "identify"; distinctId: string; role?: string };

type IdentityListener = (action: PostHogIdentityAction) => void;

let currentAction: PostHogIdentityAction = { type: "reset" };
let listener: IdentityListener | null = null;

const publish = () => listener?.(currentAction);

export const setPostHogIdentity = (distinctId: string, role?: string) => {
  currentAction = { type: "identify", distinctId, ...(role ? { role } : {}) };
  publish();
};

export const resetPostHogIdentity = () => {
  currentAction = { type: "reset" };
  publish();
};

export const subscribePostHogIdentity = (nextListener: IdentityListener) => {
  listener = nextListener;
  nextListener(currentAction);
  return () => {
    if (listener === nextListener) listener = null;
  };
};
