export type SubmissionConfirmationPayload = {
  kind: "contact_sales" | "demo" | "support" | "security_report";
  submissionRef: string;
  submittedAt: string;
};

const STORAGE_KEY = "itemtraxx.submit-confirmation";

export const saveSubmissionConfirmation = (payload: SubmissionConfirmationPayload) => {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
};

export const clearSubmissionConfirmation = () => {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(STORAGE_KEY);
};
