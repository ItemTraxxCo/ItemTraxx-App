export const ITEM_STATUS_OPTIONS = [
  "available",
  "checked_out",
  "damaged",
  "lost",
  "in_repair",
  "retired",
  "in_studio_only",
] as const;

const ITEM_STATUS_LABELS: Record<(typeof ITEM_STATUS_OPTIONS)[number], string> = {
  available: "Available",
  checked_out: "Checked out",
  damaged: "Damaged",
  lost: "Lost",
  in_repair: "In repair",
  retired: "Retired",
  in_studio_only: "In studio only",
};

export const formatItemStatus = (status: string): string => {
  const normalized = status.trim().toLowerCase();
  if (!normalized) return "";

  const knownLabel = ITEM_STATUS_LABELS[normalized as keyof typeof ITEM_STATUS_LABELS];
  if (knownLabel) return knownLabel;

  const spaced = normalized.replace(/[_-]+/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};
