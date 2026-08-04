import { onScopeDispose, watch } from "vue";
import { initializeIntercom, shutdownIntercom, type IntercomUser } from "../services/intercomService";

type IntercomAuthState = {
  isInitialized: boolean;
  isAuthenticated: boolean;
  userId: string | null;
  email: string | null;
};

export const useIntercom = (auth: IntercomAuthState) => {
  const sync = () => {
    if (auth.isInitialized && auth.isAuthenticated && auth.userId) {
      const user: IntercomUser = { userId: auth.userId, email: auth.email };
      void initializeIntercom(user);
      return;
    }

    // Boot anonymous visitors while auth is loading or when no session exists.
    // The SDK only receives an app ID in this branch, so no account identity is
    // sent and Intercom can associate the conversation with its browser cookie.
    void initializeIntercom();
  };

  watch(
    () => [auth.isInitialized, auth.isAuthenticated, auth.userId, auth.email] as const,
    sync,
    { immediate: true },
  );

  onScopeDispose(shutdownIntercom);
};
