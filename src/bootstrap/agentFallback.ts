type DocumentRoot = Pick<Document, "documentElement">;

/**
 * The initial document contains a crawler-readable fallback. Mark it as
 * complete as soon as Vue has mounted so a delayed fallback can never linger
 * after the application is ready.
 */
export const markAgentFallbackMounted = (documentRef: DocumentRoot = document) => {
  documentRef.documentElement.dataset.itemtraxxAppMounted = "true";
  documentRef.documentElement.dataset.itemtraxxFallbackState = "mounted";
};
