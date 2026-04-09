export type SubmissionConfirmationField = {
  label: string;
  value: string;
};

export type SubmissionConfirmationPayload = {
  kind: string;
  title: string;
  lead: string;
  submittedAt: string;
  referenceId?: string | null;
  fields: SubmissionConfirmationField[];
};

const STORAGE_KEY = "itemtraxx.submit-confirmation";

export const saveSubmissionConfirmation = (payload: SubmissionConfirmationPayload) => {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
};

export const readSubmissionConfirmation = () => {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SubmissionConfirmationPayload;
  } catch {
    window.sessionStorage.removeItem(STORAGE_KEY);
    return null;
  }
};

export const clearSubmissionConfirmation = () => {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(STORAGE_KEY);
};
