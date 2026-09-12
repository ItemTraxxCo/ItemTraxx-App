import { useRouter } from "vue-router";

export const useLogout = () => {
  const router = useRouter();

  // Returns whether the user confirmed the sign-out prompt, so callers that
  // close their own UI (e.g. a dropdown) only do so when the user actually acted.
  const logout = async (): Promise<boolean> => {
    if (!window.confirm("Are you sure you want to log out?")) return false;
    const { getPostSignOutUrl, signOut } = await import("../services/authService");
    const nextUrl = getPostSignOutUrl();
    const result = await signOut();
    if (!result.ok) {
      window.alert("Unable to complete logout. Please try again.");
      return true;
    }
    if (nextUrl.startsWith("http")) window.location.assign(nextUrl);
    else await router.push(nextUrl);
    return true;
  };

  return { logout };
};
