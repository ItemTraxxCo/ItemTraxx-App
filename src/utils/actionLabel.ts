export const ITEM_LOG_ACTION_OPTIONS = [
  { value: "checkout", label: "Checkout" },
  { value: "return", label: "Return" },
  { value: "auto", label: "Automatic transaction" },
  { value: "admin_return", label: "Admin return" },
  { value: "quick_return", label: "Quick return" },
] as const;

const ACTION_LABELS: Record<string, string> = {
  admin_return: "Admin return",
  quick_return: "Quick return",
  auto: "Automatic transaction",
  automatic: "Automatic transaction",
  "eq.checkout": "Checkout",
  "eq.return": "Return",
  admin_login: "Admin sign-in",
  borrower_create: "Borrower created",
  borrower_archive: "Borrower archived",
  borrower_restore: "Borrower restored",
  item_create: "Item created",
  item_update: "Item updated",
  item_archive: "Item archived",
  item_restore: "Item restored",
  item_bulk_import: "Items imported",
  "item.create": "Item created",
  "item.update": "Item updated",
  "item.delete": "Item deleted",
};

export const formatActionLabel = (action: string | null | undefined): string => {
  const normalized = action?.trim().toLowerCase() ?? "";
  if (!normalized) return "Unknown action";

  const knownLabel = ACTION_LABELS[normalized];
  if (knownLabel) return knownLabel;

  const words = normalized.replace(/[._-]+/g, " ").replace(/\s+/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};
