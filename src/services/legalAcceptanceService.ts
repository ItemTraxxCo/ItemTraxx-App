import { invokeEdgeFunction } from "./edgeFunctionClient";

export type LegalDocumentType =
  | "terms_of_service"
  | "privacy_policy"
  | "student_privacy_notice"
  | "dpa";

export type PendingLegalDocument = {
  document_type: LegalDocumentType;
  document_version: string;
  document_hash: string;
  url_path: string;
  effective_at: string;
};

export type LegalAcceptanceReceipt = {
  accepted_at: string;
  already_accepted: boolean;
};

/**
 * Documents the signed-in user still has to accept (newest effective version of
 * each required document). An empty list means the user is up to date.
 */
export const fetchPendingLegalDocuments = async (): Promise<PendingLegalDocument[]> => {
  const result = await invokeEdgeFunction<{ data?: { pending?: PendingLegalDocument[] } }>(
    "legal-acceptance",
    { method: "POST", body: { action: "status" } },
  );
  if (!result.ok) {
    throw new Error(result.error || "Unable to load legal document status.");
  }
  return result.data?.data?.pending ?? [];
};

/**
 * Records explicit acceptance. The server derives user, workspace, IP address,
 * user agent, and timestamp; the client only names the document it displayed.
 */
export const acceptLegalDocument = async (
  document: Pick<PendingLegalDocument, "document_type" | "document_version" | "document_hash">,
): Promise<LegalAcceptanceReceipt> => {
  const result = await invokeEdgeFunction<{ data?: LegalAcceptanceReceipt }>(
    "legal-acceptance",
    {
      method: "POST",
      body: {
        action: "accept",
        document_type: document.document_type,
        document_version: document.document_version,
        document_hash: document.document_hash,
      },
    },
  );
  const receipt = result.data?.data;
  if (!result.ok || !receipt?.accepted_at) {
    throw new Error(result.error || "Unable to record your acceptance. Please try again.");
  }
  return receipt;
};
