export const createRequestId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `itx-${Date.now()}-${Math.floor(performance.now() * 1000)}`;
};
