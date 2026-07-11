let pendingSuperAdminVerificationEmail: string | null = null;
let pendingSuperAdminChallengeToken: string | null = null;

export const setPendingSuperAdminVerificationEmail = (email: string | null) => {
  pendingSuperAdminVerificationEmail = email;
};

export const setPendingSuperAdminChallengeToken = (challengeToken: string | null) => {
  pendingSuperAdminChallengeToken = challengeToken;
};

export const getPendingSuperAdminChallengeToken = () => pendingSuperAdminChallengeToken;

export const getPendingSuperAdminVerificationEmail = () => pendingSuperAdminVerificationEmail;

export const clearPendingSuperAdminVerificationEmail = () => {
  setPendingSuperAdminVerificationEmail(null);
  setPendingSuperAdminChallengeToken(null);
};
