export function isOrganizationGraphEnabledForActor(input: {
  featureEnabled: boolean;
  orgAllowlist: string[];
  userAllowlist: string[];
  orgId: string;
  userId: string;
}) {
  if (!input.featureEnabled) {
    return false;
  }

  const orgAllowlist = new Set(input.orgAllowlist.map((item) => item.trim()).filter(Boolean));
  const userAllowlist = new Set(input.userAllowlist.map((item) => item.trim()).filter(Boolean));

  const orgAllowed = orgAllowlist.size === 0 || orgAllowlist.has(input.orgId);
  const userAllowed = userAllowlist.size === 0 || userAllowlist.has(input.userId);

  return orgAllowed && userAllowed;
}
