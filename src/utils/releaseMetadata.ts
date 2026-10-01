export const getReleaseMetadata = () => {
  const appVersion = import.meta.env.VITE_GIT_COMMIT || "n/a";
  const appBranch = import.meta.env.VITE_GIT_BRANCH || "n/a";
  const currentYear = new Date().getFullYear();
  const runtimeEnvironment = (
    import.meta.env.VITE_POSTHOG_ENVIRONMENT ||
    import.meta.env.MODE ||
    ""
  ).trim().toLowerCase();
  const runtimeHostname =
    typeof window !== "undefined" ? window.location.hostname.trim().toLowerCase() : "";
  const isDevHost =
    runtimeHostname === "dev.itemtraxx.com" || runtimeHostname.endsWith(".dev.itemtraxx.com");

  const releaseChannel =
    isDevHost
      ? "Development"
      : runtimeEnvironment === "production"
        ? "Production"
        : runtimeEnvironment === "preview"
          ? "Preview"
          : runtimeEnvironment === "beta"
            ? "Beta"
            : "Development";

  const showBranchName = Boolean(appBranch && appBranch !== "n/a" && appBranch !== "main");

  return { appVersion, appBranch, currentYear, releaseChannel, showBranchName };
};
