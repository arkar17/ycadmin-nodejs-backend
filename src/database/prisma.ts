import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';

import { env } from '../config/env.js';

let client: PrismaClient | undefined;
let pool: Pool | undefined;

/**
 * Creates a Prisma 7 client only when a database-backed request needs one.
 * Health checks and mock-based tests never call this factory.
 */
export const getPrismaClient = (): PrismaClient => {
  if (client) return client;

  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required before using database-backed repositories.');
  }

  pool = new Pool({ connectionString: env.DATABASE_URL });
  client = new PrismaClient({ adapter: new PrismaPg(pool) });
  return client;
};

export const disconnectDatabase = async (): Promise<void> => {
  await client?.$disconnect();
  await pool?.end();
  client = undefined;
  pool = undefined;
};
