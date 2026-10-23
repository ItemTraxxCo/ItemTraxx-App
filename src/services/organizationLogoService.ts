import { authApiBaseURL, authApiFetch } from "../auth/client";

type OrganizationLogoUploadResponse = {
  logoUrl?: string;
  error?: string;
};

export const uploadOrganizationLogo = async (organizationId: string, file: File) => {
  const response = await authApiFetch(
    `${authApiBaseURL}/api/organization/${encodeURIComponent(organizationId)}/logo`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": file.type },
      body: file,
    },
  );

  let payload: OrganizationLogoUploadResponse = {};
  try {
    payload = await response.json() as OrganizationLogoUploadResponse;
  } catch {
    // Use the response status fallback when the Worker did not return JSON.
  }

  if (!response.ok) {
    throw new Error(payload.error || "Unable to upload the organization logo.");
  }
  if (!payload.logoUrl) {
    throw new Error("The logo upload completed without returning a logo URL.");
  }
  return payload.logoUrl;
};
