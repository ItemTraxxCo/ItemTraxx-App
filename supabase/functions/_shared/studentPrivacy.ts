export const CURRENT_TERMS_VERSION = "2026-06-11";

export const STUDENT_PRIVACY_AGREEMENT_CONTEXT =
  "authorized_adult_school_student_privacy_attestation";

type LegalAcceptanceRecord = {
  terms_version?: string | null;
  agreement_context?: string | null;
};

export const isCurrentStudentPrivacyAcceptance = (
  record: LegalAcceptanceRecord | null | undefined,
) =>
  record?.terms_version === CURRENT_TERMS_VERSION &&
  record.agreement_context === STUDENT_PRIVACY_AGREEMENT_CONTEXT;
