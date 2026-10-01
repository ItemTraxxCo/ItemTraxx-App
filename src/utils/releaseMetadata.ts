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
  const normalizedBranch = appBranch.trim().toLowerCase();
  const hasBranchMetadata = Boolean(normalizedBranch && normalizedBranch !== "n/a");
  const isNonMainBranch = hasBranchMetadata && normalizedBranch !== "main";
  const branchReleaseChannel =
    normalizedBranch === "main"
      ? "Production"
      : normalizedBranch === "staging" || normalizedBranch.startsWith("staging/")
        ? "Staging"
        : normalizedBranch === "preview" || normalizedBranch.startsWith("preview/")
          ? "Preview"
          : normalizedBranch === "dev" || normalizedBranch.startsWith("dev/")
            ? "Development"
            : null;

  const releaseChannel =
    isDevHost
      ? "Development"
      : branchReleaseChannel ??
        (runtimeEnvironment === "beta"
          ? "Beta"
          : runtimeEnvironment === "preview" ||
              (runtimeEnvironment === "production" && isNonMainBranch)
            ? "Preview"
            : runtimeEnvironment === "production"
              ? "Production"
              : "Development");

  const showBranchName = Boolean(appBranch && appBranch !== "n/a" && appBranch !== "main");

  return { appVersion, appBranch, currentYear, releaseChannel, showBranchName };
};
