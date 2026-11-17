import type { Logger } from 'pino';

export type RbacSecurityAuditOutcome = 'changed' | 'no_change' | 'rejected';

export type RbacSecurityAuditEvent = {
  requestId: string;
  actorUserId: number;
  action: string;
  targetType: 'User' | 'Role' | 'Permission' | 'UserRole' | 'RolePermission';
  targetId?: number;
  beforeIds?: number[];
  afterIds?: number[];
  outcome: RbacSecurityAuditOutcome;
  reasonCode?: string;
};

export interface RbacSecurityAuditSink {
  record(event: RbacSecurityAuditEvent): void;
}

/**
 * Operational security logging only. This is intentionally not represented as
 * a database audit table and cannot provide durable, transactional audit history.
 */
export class PinoRbacSecurityAuditSink implements RbacSecurityAuditSink {
  public constructor(private readonly logger: Pick<Logger, 'info'>) {}

  public record(event: RbacSecurityAuditEvent): void {
    this.logger.info({ securityAudit: event }, 'Admin RBAC security event');
  }
}
