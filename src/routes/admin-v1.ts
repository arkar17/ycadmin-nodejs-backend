import { Router } from 'express';

import { attendanceQrCryptoFromEnvironment } from '../config/attendance-qr.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { pushConfigFromEnvironment } from '../config/push.js';
import { PrismaAdminPermissionRepository } from '../modules/admin-permissions/admin-permission.repository.js';
import { createAdminPermissionRouter } from '../modules/admin-permissions/admin-permission.router.js';
import { PrismaAdminRoleRepository } from '../modules/admin-roles/admin-role.repository.js';
import { createAdminRoleRouter } from '../modules/admin-roles/admin-role.router.js';
import { PrismaAdminUserRepository } from '../modules/admin-users/admin-user.repository.js';
import { createAdminUserRouter } from '../modules/admin-users/admin-user.router.js';
import { PrismaAdminIdentityRepository } from '../modules/auth/admin-identity.repository.js';
import { PrismaAdminLoginRepository } from '../modules/auth/admin-login.repository.js';
import { createAuthRouter } from '../modules/auth/auth.router.js';
import { PrismaCurrentAdminRepository } from '../modules/auth/current-admin.repository.js';
import { createCurrentAdminRouter } from '../modules/auth/current-admin.router.js';
import { PrismaAttendanceRepository } from '../modules/attendance/attendance.repository.js';
import { createAttendanceQrRouter } from '../modules/attendance/attendance-qr.router.js';
import { AttendanceQrCredentialService, UnavailableAttendanceQrCredentialService } from '../modules/attendance/attendance-qr-credential.service.js';
import { PrismaManualAttendanceRepository } from '../modules/attendance/manual-attendance.repository.js';
import { createAttendanceRouter } from '../modules/attendance/attendance.router.js';
import { PrismaBankInformationRepository } from '../modules/bank-information/bank-information.repository.js';
import { createBankInformationRouter } from '../modules/bank-information/bank-information.router.js';
import { PrismaDashboardRepository } from '../modules/dashboard/dashboard.repository.js';
import { createDashboardRouter } from '../modules/dashboard/dashboard.router.js';
import { PrismaFeedbackRepository } from '../modules/feedback/feedback.repository.js';
import { createFeedbackRouter } from '../modules/feedback/feedback.router.js';
import { healthRouter } from '../modules/health/routes.js';
import { PrismaMemberDirectoryRepository } from '../modules/members/member-directory.repository.js';
import { createMemberDirectoryRouter } from '../modules/members/member-directory.router.js';
import { PrismaMembershipRequestRepository } from '../modules/membership-requests/membership-request.repository.js';
import { createMembershipRequestRouter } from '../modules/membership-requests/membership-request.router.js';
import { PrismaMemberTypeRepository } from '../modules/member-types/member-type.repository.js';
import { createMemberTypeRouter } from '../modules/member-types/member-type.router.js';
import { PrismaMemberPlanRepository } from '../modules/member-plans/member-plan.repository.js';
import { createMemberPlanRouter } from '../modules/member-plans/member-plan.router.js';
import { PrismaPlanDurationRepository } from '../modules/plan-durations/plan-duration.repository.js';
import { createPlanDurationRouter } from '../modules/plan-durations/plan-duration.router.js';
import { createPaymentRouter } from '../modules/payments/payment.router.js';
import { createPaymentPushNotificationService } from '../modules/payments/payment-push.factory.js';
import { PrismaShopPlanLevelRepository } from '../modules/shop-plan-levels/shop-plan-level.repository.js';
import { createShopPlanLevelRouter } from '../modules/shop-plan-levels/shop-plan-level.router.js';
import { PrismaShopRepository } from '../modules/shops/shop.repository.js';
import { createShopRouter } from '../modules/shops/shop.router.js';
import { PrismaShopUpgradeRequestRepository } from '../modules/shop-upgrade-requests/shop-upgrade-request.repository.js';
import { createShopUpgradeRequestRouter } from '../modules/shop-upgrade-requests/shop-upgrade-request.router.js';
import { PrismaWorkoutRepository } from '../modules/workouts/workout.repository.js';
import { createWorkoutRouter } from '../modules/workouts/workout.router.js';

export const adminV1Router = Router();

// Public operational endpoint. It intentionally does not access Prisma or PostgreSQL.
adminV1Router.use('/health', healthRouter);

// This is deliberately the only unauthenticated Admin route besides health.
// It verifies active User credentials but never assigns roles or permissions.
adminV1Router.use('/auth', createAuthRouter({ adminLoginRepository: new PrismaAdminLoginRepository() }));

// The identity endpoint rehydrates roles and effective permissions from the
// database. It intentionally has no feature-permission requirement.
adminV1Router.use(
  '/auth',
  createCurrentAdminRouter({
    adminIdentityRepository: new PrismaAdminIdentityRepository(),
    currentAdminRepository: new PrismaCurrentAdminRepository(),
  }),
);

adminV1Router.use(
  '/users',
  createAdminUserRouter({
    adminIdentityRepository: new PrismaAdminIdentityRepository(),
    adminUserRepository: new PrismaAdminUserRepository(),
  }),
);

adminV1Router.use(
  '/roles',
  createAdminRoleRouter({
    adminIdentityRepository: new PrismaAdminIdentityRepository(),
    adminRoleRepository: new PrismaAdminRoleRepository(),
  }),
);

adminV1Router.use(
  '/permissions',
  createAdminPermissionRouter({
    adminIdentityRepository: new PrismaAdminIdentityRepository(),
    adminPermissionRepository: new PrismaAdminPermissionRepository(),
  }),
);

// `dashboard:read` is a proposed permission absent from the shared catalog today.
// This route fails closed until the owner provisions it to an Admin role.
adminV1Router.use(
  '/dashboard',
  createDashboardRouter({
    adminIdentityRepository: new PrismaAdminIdentityRepository(),
    dashboardRepository: new PrismaDashboardRepository(),
  }),
);

// Verified against the copied shared schema and isolated PostgreSQL integration tests.
// Repository construction is lazy; no database connection occurs until a protected request.
adminV1Router.use(
  '/members',
  createMemberDirectoryRouter({
    adminIdentityRepository: new PrismaAdminIdentityRepository(),
    memberDirectoryRepository: new PrismaMemberDirectoryRepository(),
  }),
);

// Read-only route registered after mocked and isolated PostgreSQL integration verification.
adminV1Router.use(
  '/attendance',
  createAttendanceRouter({
    adminIdentityRepository: new PrismaAdminIdentityRepository(),
    attendanceRepository: new PrismaAttendanceRepository(),
    manualAttendanceRepository: new PrismaManualAttendanceRepository(),
  }),
);

// The path remains protected and fails closed with 503 until both keys are
// supplied by the approved secret-management integration. No key material is
// stored in PostgreSQL or generated as an application fallback.
const attendanceQrCrypto = attendanceQrCryptoFromEnvironment();
adminV1Router.use(
  '/attendance/qr',
  createAttendanceQrRouter({
    adminIdentityRepository: new PrismaAdminIdentityRepository(),
    credentialService: attendanceQrCrypto
      ? new AttendanceQrCredentialService(attendanceQrCrypto)
      : new UnavailableAttendanceQrCredentialService(),
  }),
);

// Safe reads and transactional membership decisions registered after mocked and
// isolated PostgreSQL integration verification.
adminV1Router.use(
  '/membership-requests',
  createMembershipRequestRouter({
    adminIdentityRepository: new PrismaAdminIdentityRepository(),
    membershipRequestRepository: new PrismaMembershipRequestRepository(),
  }),
);

// Payment push is disabled unless PAYMENT_PUSH_ENABLED=true. When enabled,
// invalid Firebase configuration fails startup here with a sanitized error;
// the Firebase SDK is never loaded while push is disabled.
const paymentPushNotificationService = await createPaymentPushNotificationService({
  config: pushConfigFromEnvironment(env),
  log: logger,
});
adminV1Router.use(
  '/payments',
  createPaymentRouter({
    adminIdentityRepository: new PrismaAdminIdentityRepository(),
    paymentPushNotificationService,
  }),
);

adminV1Router.use(
  '/feedback',
  createFeedbackRouter({
    adminIdentityRepository: new PrismaAdminIdentityRepository(),
    feedbackRepository: new PrismaFeedbackRepository(),
  }),
);

adminV1Router.use(
  '/plan-durations',
  createPlanDurationRouter({
    adminIdentityRepository: new PrismaAdminIdentityRepository(),
    planDurationRepository: new PrismaPlanDurationRepository(),
  }),
);

adminV1Router.use(
  '/member-types',
  createMemberTypeRouter({
    adminIdentityRepository: new PrismaAdminIdentityRepository(),
    memberTypeRepository: new PrismaMemberTypeRepository(),
  }),
);

// ShopLevel is a distinct mobile shop catalogue. Only its verified read contract is
// exposed; Odoo's level_count workflow and all mutations remain intentionally deferred.
adminV1Router.use(
  '/shop-plan-levels',
  createShopPlanLevelRouter({
    adminIdentityRepository: new PrismaAdminIdentityRepository(),
    shopPlanLevelRepository: new PrismaShopPlanLevelRepository(),
  }),
);

adminV1Router.use(
  '/shops',
  createShopRouter({
    adminIdentityRepository: new PrismaAdminIdentityRepository(),
    shopRepository: new PrismaShopRepository(),
  }),
);

adminV1Router.use(
  '/shop-upgrade-requests',
  createShopUpgradeRequestRouter({
    adminIdentityRepository: new PrismaAdminIdentityRepository(),
    shopUpgradeRequestRepository: new PrismaShopUpgradeRequestRepository(),
  }),
);

adminV1Router.use(
  '/member-plans',
  createMemberPlanRouter({
    adminIdentityRepository: new PrismaAdminIdentityRepository(),
    memberPlanRepository: new PrismaMemberPlanRepository(),
  }),
);

// Registered only after mocked and isolated PostgreSQL integration verification.
adminV1Router.use(
  '/bank-information',
  createBankInformationRouter({
    adminIdentityRepository: new PrismaAdminIdentityRepository(),
    bankInformationRepository: new PrismaBankInformationRepository(),
  }),
);

// Read-only workout discovery is schema-backed and integration-safe. Mutations
// remain deferred until media storage and historical-data rules are approved.
adminV1Router.use(
  '/workout-videos',
  createWorkoutRouter({
    adminIdentityRepository: new PrismaAdminIdentityRepository(),
    workoutRepository: new PrismaWorkoutRepository(),
  }),
);

