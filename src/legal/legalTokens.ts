// Values for the [[TOKEN]] placeholders used in docs/legal/*.md.
// Any token left undefined or empty renders as a highlighted "pending" marker
// so an unfinished draft is never mistaken for final text.
// Tokens that are deliberately still open (decisions or facts not yet confirmed).
// They render as a highlighted "pending" marker until a value is added below.
// Empty means every token in docs/legal is filled.
export const LEGAL_PENDING_TOKENS: readonly string[] = [];

export const LEGAL_TOKEN_VALUES: Readonly<Record<string, string | undefined>> = {
  EFFECTIVE_DATE: "November 4, 2026",
  ENTITY_DESCRIPTION: "ItemTraxx Co.",
  MAILING_ADDRESS: "Palo Alto, CA",
  GOVERNING_COUNTY: "Santa Clara County, California",
  DATABASE_REGION: "US-West",
  BACKUP_LOCATION: "US-West",
  BACKUP_RETENTION_DAYS: "30",
  ANALYTICS_RETENTION: "90 days",
  OTHER_DATA_INCIDENT_NOTICE: "72 hours",
  ERROR_REPORT_RETENTION_DAYS: "90",
  DATA_BREACH_CAP:
    "the total fees paid or payable by the Customer for the Service during the 12 months before the event giving rise to the claim",
};
