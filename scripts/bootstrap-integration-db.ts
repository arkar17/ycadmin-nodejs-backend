/**
 * Bootstraps the disposable localhost integration database from scratch:
 *
 *   A. every authoritative migration from the Mobile API checkout
 *      (`ycfitness-api/prisma/migrations`, read-only), applied with THIS
 *      repository's pinned Prisma CLI — never `npx prisma`, never the Mobile
 *      checkout's node_modules;
 *   B. then only the quarantined Admin attendance proposal SQL from
 *      `prisma/proposals/attendance/migrations`.
 *
 * It never applies `prisma/migrations` or `prisma/migrations-disabled` from this
 * repository, never reads DATABASE_URL, and refuses any database other than the
 * dedicated `yc_fitness_admin_integration` on localhost:55432.
 *
 * Usage:
 *   npm run db:integration:bootstrap
 *   YC_FITNESS_API_PATH=/custom/ycfitness-api npm run db:integration:bootstrap
 *   npm run db:integration:bootstrap -- --authoritative /custom/ycfitness-api
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

import {
  assertIsolatedIntegrationDatabaseUrl,
  ISOLATED_INTEGRATION_DATABASE_URL,
} from '../src/tests/integration-database-safety.js';

class BootstrapError extends Error {}

const adminRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const proposalDirectory = path.join(adminRoot, 'prisma', 'proposals', 'attendance', 'migrations');
const adminSchemaPath = path.join(adminRoot, 'prisma', 'schema.prisma');

const step = (message: string) => console.log(`\n▶ ${message}`);
const info = (message: string) => console.log(`  ${message}`);

const readJson = (file: string): Record<string, any> => JSON.parse(fs.readFileSync(file, 'utf8'));

/** Resolves and validates the read-only authoritative Mobile API checkout. */
const resolveMobileCheckout = () => {
  const flagIndex = process.argv.indexOf('--authoritative');
  if (flagIndex >= 0 && !process.argv[flagIndex + 1]) {
    throw new BootstrapError('--authoritative requires a path to the ycfitness-api checkout.');
  }
  const configured = flagIndex >= 0 ? process.argv[flagIndex + 1] : process.env.YC_FITNESS_API_PATH;
  const root = path.resolve(configured ?? path.join(adminRoot, '..', 'ycfitness-api'));
  const source = configured ? 'configured' : 'default sibling';
  const schema = path.join(root, 'prisma', 'schema.prisma');
  const migrations = path.join(root, 'prisma', 'migrations');
  const lock = path.join(migrations, 'migration_lock.toml');

  const hint = 'Clone ycfitness-api next to this repository, or set YC_FITNESS_API_PATH=/path/to/ycfitness-api.';
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new BootstrapError(`Mobile API checkout not found at ${root} (${source} path). ${hint}`);
  }
  if (!fs.existsSync(schema)) {
    throw new BootstrapError(`${root} is not a ycfitness-api checkout: prisma/schema.prisma is missing. ${hint}`);
  }
  if (!fs.existsSync(lock) || !/provider\s*=\s*"postgresql"/.test(fs.readFileSync(lock, 'utf8'))) {
    throw new BootstrapError(`${migrations} is missing a PostgreSQL migration_lock.toml. ${hint}`);
  }
  const migrationNames = fs.readdirSync(migrations, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const incomplete = migrationNames.filter((name) => !fs.existsSync(path.join(migrations, name, 'migration.sql')));
  if (migrationNames.length === 0 || incomplete.length > 0) {
    throw new BootstrapError(`Authoritative migrations are empty or incomplete in ${migrations}: ${incomplete.join(', ') || 'none found'}.`);
  }
  return { root, source, schema, migrations, migrationNames };
};

/** Resolves this repository's pinned Prisma CLI and checks it matches the Mobile API's lockfile. */
const resolvePinnedPrisma = (mobileRoot: string) => {
  const pinned = readJson(path.join(adminRoot, 'package.json')).devDependencies?.prisma;
  if (typeof pinned !== 'string' || !/^\d+\.\d+\.\d+$/.test(pinned)) {
    throw new BootstrapError('package.json must pin devDependencies.prisma to an exact version.');
  }
  const packageFile = path.join(adminRoot, 'node_modules', 'prisma', 'package.json');
  const cli = path.join(adminRoot, 'node_modules', 'prisma', 'build', 'index.js');
  if (!fs.existsSync(packageFile) || !fs.existsSync(cli)) {
    throw new BootstrapError(`The local Prisma CLI is not installed. Run \`npm ci\` in ${adminRoot} first.`);
  }
  const installed = readJson(packageFile).version;
  if (installed !== pinned) {
    throw new BootstrapError(`Installed Prisma CLI ${installed} does not match the pinned ${pinned}. Run \`npm ci\`.`);
  }

  const mobileLock = path.join(mobileRoot, 'package-lock.json');
  const mobileVersion = fs.existsSync(mobileLock)
    ? readJson(mobileLock).packages?.['node_modules/prisma']?.version
    : undefined;
  if (mobileVersion && mobileVersion !== installed) {
    throw new BootstrapError(
      `Prisma CLI mismatch: Admin pins ${installed} but the Mobile API lockfile uses ${mobileVersion}. `
      + 'Align versions in a dedicated dependency task before bootstrapping.',
    );
  }
  return { cli, version: installed, mobileVersion: mobileVersion ?? 'unknown (no package-lock.json)' };
};

const resolveProposalFiles = () => {
  const entries = fs.readdirSync(proposalDirectory).sort();
  const unexpected = entries.filter((name) => !/^\d{14}_[a-z0-9_]+\.sql$/.test(name));
  if (unexpected.length > 0) {
    throw new BootstrapError(`Unexpected entries in ${proposalDirectory}: ${unexpected.join(', ')}.`);
  }
  if (entries.length === 0) throw new BootstrapError(`No attendance proposal SQL found in ${proposalDirectory}.`);
  return entries.map((name) => ({ name, file: path.join(proposalDirectory, name) }));
};

const runPrisma = (cli: string, args: string[], databaseUrl: string, cwd: string) => {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    // Only the guarded integration URL is supplied; a developer's DATABASE_URL is replaced.
    env: { ...process.env, DATABASE_URL: databaseUrl, PRISMA_HIDE_UPDATE_MESSAGE: '1' },
  });
  if (result.error) throw new BootstrapError(`Could not start the Prisma CLI: ${result.error.message}`);
  return result;
};

const describeTarget = (url: URL) => `${url.hostname}:${url.port}/${url.pathname.slice(1)} as ${url.username}`;

const main = async () => {
  step('Checking safety guards');
  const databaseUrl = process.env.ADMIN_INTEGRATION_DATABASE_URL ?? ISOLATED_INTEGRATION_DATABASE_URL;
  const target = assertIsolatedIntegrationDatabaseUrl(databaseUrl);
  info(`target database: ${describeTarget(target)}`);

  const mobile = resolveMobileCheckout();
  info(`authoritative checkout (${mobile.source}, read-only): ${mobile.root}`);
  info(`authoritative migrations: ${mobile.migrationNames.length}`);
  const prisma = resolvePinnedPrisma(mobile.root);
  info(`Prisma CLI: ${prisma.version} (local, pinned); Mobile lockfile: ${prisma.mobileVersion}`);
  const proposals = resolveProposalFiles();
  info(`attendance proposal files: ${proposals.length}`);

  const client = new pg.Client({ connectionString: databaseUrl });
  try {
    await client.connect();
  } catch {
    throw new BootstrapError(
      `Cannot connect to ${describeTarget(target)}. Start it with: `
      + 'docker compose -f docker-compose.integration.yml up -d --wait postgres-integration',
    );
  }

  const workDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'yc-admin-integration-bootstrap-'));
  try {
    step('Checking that the database is fresh');
    const { rows: [existing] } = await client.query<{ relations: string; types: string }>(`
      SELECT
        (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public') AS relations,
        (SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public' AND t.typtype = 'e') AS types
    `);
    if (Number(existing!.relations) > 0 || Number(existing!.types) > 0) {
      throw new BootstrapError(
        'The integration database is not empty, so bootstrap will not run again on top of it. Recreate it with:\n'
        + '  docker compose -f docker-compose.integration.yml down -v\n'
        + '  docker compose -f docker-compose.integration.yml up -d --wait postgres-integration',
      );
    }
    info('public schema is empty');

    step(`A. Applying ${mobile.migrationNames.length} authoritative Mobile API migrations (Prisma ${prisma.version})`);
    // A throwaway config points the pinned CLI at the read-only Mobile schema and
    // migrations. It deliberately does not load dotenv or this repo's prisma.config.ts.
    const configFile = path.join(workDirectory, 'prisma.config.mjs');
    fs.writeFileSync(configFile, [
      'export default {',
      `  schema: ${JSON.stringify(mobile.schema)},`,
      `  migrations: { path: ${JSON.stringify(mobile.migrations)} },`,
      '  datasource: { url: process.env.DATABASE_URL },',
      '};',
      '',
    ].join('\n'));
    const deploy = runPrisma(prisma.cli, ['migrate', 'deploy', '--config', configFile], databaseUrl, workDirectory);
    if (deploy.status !== 0) {
      process.stderr.write(deploy.stdout + deploy.stderr);
      throw new BootstrapError('prisma migrate deploy failed; the database is partially migrated. Recreate it before retrying.');
    }
    const { rows: [applied] } = await client.query<{ done: string; bad: string }>(`
      SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS done,
             count(*) FILTER (WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL) AS bad
      FROM _prisma_migrations
    `);
    if (Number(applied!.done) !== mobile.migrationNames.length || Number(applied!.bad) !== 0) {
      throw new BootstrapError(
        `Expected ${mobile.migrationNames.length} applied migrations, found ${applied!.done} applied and ${applied!.bad} failed/rolled back.`,
      );
    }
    info(`applied ${applied!.done}/${mobile.migrationNames.length} migrations`);

    step('B. Applying Admin attendance proposal SQL (integration database only)');
    for (const proposal of proposals) {
      const sql = fs.readFileSync(proposal.file, 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        const reason = error instanceof Error ? error.message : String(error);
        throw new BootstrapError(`Proposal ${proposal.name} failed and was rolled back: ${reason}`);
      }
      info(`applied ${proposal.name}`);
    }

    step('Verifying database matches prisma/schema.prisma (the generated client source)');
    const diff = runPrisma(
      prisma.cli,
      ['migrate', 'diff', '--config', configFile, '--from-config-datasource', '--to-schema', adminSchemaPath, '--script', '--exit-code'],
      databaseUrl,
      workDirectory,
    );
    if (diff.status === 2) {
      process.stderr.write(diff.stdout);
      throw new BootstrapError('Schema mismatch: the bootstrapped database differs from prisma/schema.prisma (SQL diff above).');
    }
    if (diff.status !== 0) {
      process.stderr.write(diff.stdout + diff.stderr);
      throw new BootstrapError('prisma migrate diff failed.');
    }
    info('no drift');

    console.log('\n✔ Integration database bootstrapped. Run: npm run test:integration');
  } finally {
    await client.end().catch(() => undefined);
    fs.rmSync(workDirectory, { recursive: true, force: true });
  }
};

main().catch((error: unknown) => {
  const message = error instanceof BootstrapError || error instanceof Error ? error.message : String(error);
  console.error(`\n✖ Integration bootstrap failed: ${message}`);
  process.exitCode = 1;
});
