/**
 * Shared-schema compatibility policy.
 *
 * The legacy Mobile API depends on this exact role name. Keep the value
 * centralized and treat the matching role as protected in future Admin
 * management APIs; do not rename or scatter string comparisons.
 */
export const SYSTEM_ADMIN_ROLE_NAME = 'SuperAdmin' as const;

export const hasSystemAdminRole = (roleNames: readonly string[]): boolean =>
  roleNames.includes(SYSTEM_ADMIN_ROLE_NAME);
