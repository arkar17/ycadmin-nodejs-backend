/**
 * Shared-schema compatibility policy.
 *
 * The legacy Mobile API depends on this exact role name. Keep the value
 * centralized and treat the matching role as protected in future Admin
 * management APIs; do not rename or scatter string comparisons.
 */
export const SYSTEM_ADMIN_ROLE_NAME = 'SuperAdmin' as const;

export const isSystemAdminRoleName = (roleName: string): boolean =>
  roleName === SYSTEM_ADMIN_ROLE_NAME;

export const hasSystemAdminRole = (roleNames: readonly string[]): boolean =>
  roleNames.some(isSystemAdminRoleName);
