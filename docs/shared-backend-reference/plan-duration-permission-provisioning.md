# Plan Duration permission provisioning and integrity policy

The downloaded reference backend contains the `PlanDuration` model and a member-facing list endpoint, but no Admin duration CRUD route or corresponding permission names. The Admin API therefore proposes the established resource/action convention:

- `plan-duration:list`
- `plan-duration:create`
- `plan-duration:update`
- `plan-duration:delete`

These names exist only in the isolated test fixtures until the shared-backend owner approves and provisions them. This repository does not modify the reference backend, shared catalog, migrations, or production role assignments.

## Required shared-backend follow-up

1. Add the approved names to the reference backend's canonical permission catalog through its reviewed release process.
2. Explicitly assign each permission only to intended Admin roles. Do not bulk-assign these permissions to existing roles.
3. Provision existing shared environments through the owner's reviewed operational process, not a migration created by this Admin workspace.
4. Verify `403` behavior for each missing permission before deploying the Admin API against a shared database.

## Verified integrity policy

`PlanDuration.value` is unique. `MemberPlan.durationId` and `ShopLevel.durationId` reference `PlanDuration.id`; their database foreign keys use `ON DELETE SET NULL`. The mobile backend resolves and displays these duration relations in plan/shop/member-history flows.

The Admin API intentionally does not rely on `SET NULL`: it returns `409 DURATION_IN_USE` and refuses both update and deletion while a duration is referenced by any `MemberPlan` or `ShopLevel`. `PlanDuration` has no status/inactive field, so no soft-delete mechanism is available without a schema change. An unreferenced duration may be deleted with `204`.
