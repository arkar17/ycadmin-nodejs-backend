import 'dotenv/config';
import path from 'node:path';

export default {
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    // Deliberately points away from the historical snapshot. ycfitness-api owns
    // shared migration execution; this Admin repository is a schema consumer.
    path: path.join('prisma', 'migrations-disabled'),
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
};
