// Client identities must never be automatically provisioned as managers.
export const RYAN_PORTAL_EMAILS = ["ryanran321@gmail.com", "rhisolutions316@gmail.com"] as const;
export const CLIENT_PORTAL_ACCESS = "client.portal.access";
export const DASHBOARD_OWNER_EMAIL = "austinmck17@gmail.com";
export function isDashboardOwnerEmail(email?: string | null) {
  return email?.trim().toLowerCase() === DASHBOARD_OWNER_EMAIL;
}
export function isClientPortalEmail(email?: string | null) {
  return RYAN_PORTAL_EMAILS.some((allowed) => allowed === email?.trim().toLowerCase());
}
