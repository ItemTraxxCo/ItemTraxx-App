type EmailChangeStep = "approve" | "verify";
type AccountFlowLocationTarget = {
  location: Pick<Location, "hostname" | "pathname" | "search" | "hash">;
  history: Pick<History, "state" | "replaceState">;
  document: Pick<Document, "title">;
};

let pendingInvitationToken = "";
let pendingEmailChange: { step: EmailChangeStep; token: string } | null = null;

const isToken = (value: string | null): value is string =>
  !!value && /^[0-9a-f]{64}$/.test(value);

const readFragment = (target: AccountFlowLocationTarget) => new URLSearchParams(
  target.location.hash.startsWith("#")
    ? target.location.hash.slice(1)
    : target.location.hash,
);

/**
 * Move account-flow bearer tokens out of the address bar before monitoring,
 * route guards, or replay can observe the initial navigation.
 */
export const captureAccountFlowTokenFromLocation = (
  target: AccountFlowLocationTarget | undefined = typeof window === "undefined" ? undefined : window,
) => {
  if (!target) return;

  const pathname = target.location.pathname;
  if (pathname !== "/accept-invitation" && pathname !== "/account/email-change") return;

  // Production currently canonicalizes www.itemtraxx.com to itemtraxx.com
  // with a full-page redirect. Leave the fragment intact until that redirect
  // so the new document can capture the token before telemetry initializes.
  if (target.location.hostname.toLowerCase() === "www.itemtraxx.com") return;

  const params = readFragment(target);
  const token = params.get("token");
  if (pathname === "/accept-invitation") {
    pendingInvitationToken = isToken(token) ? token : "";
    pendingEmailChange = null;
  } else {
    const step = params.get("step");
    pendingEmailChange = isToken(token) && (step === "approve" || step === "verify")
      ? { step, token }
      : null;
    pendingInvitationToken = "";
  }

  // The token is carried in the fragment, so retain the path and ordinary
  // query string while removing it from visible history and later referrers.
  target.history.replaceState(
    target.history.state,
    target.document.title,
    `${pathname}${target.location.search}`,
  );
};

export const takeWorkspaceInvitationToken = () => {
  const token = pendingInvitationToken || (typeof window !== "undefined"
    ? readFragment(window).get("token")
    : null);
  pendingInvitationToken = "";
  return isToken(token) ? token : "";
};

export const takeAccountEmailChangeToken = () => {
  const pending = pendingEmailChange ?? (typeof window !== "undefined"
    ? (() => {
        const params = readFragment(window);
        const step = params.get("step");
        const token = params.get("token");
        return isToken(token) && (step === "approve" || step === "verify")
          ? { step, token }
          : null;
      })()
    : null);
  pendingEmailChange = null;
  return pending;
};
