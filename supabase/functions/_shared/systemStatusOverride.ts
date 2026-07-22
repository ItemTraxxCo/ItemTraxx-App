export type PublicSystemStatus = "operational" | "degraded" | "down";

export const resolveSystemStatusOverride = (value: unknown): {
  status: PublicSystemStatus;
  summary: string;
} | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  switch ((value as Record<string, unknown>).mode) {
    case "running":
      return { status: "operational", summary: "manual status override: running" };
    case "degraded":
      return { status: "degraded", summary: "manual status override: degraded" };
    case "outage":
      return { status: "down", summary: "manual status override: outage" };
    default:
      return null;
  }
};
