import { Status } from '@prisma/client';

import { getPrismaClient } from '../../database/prisma.js';

export type AdminLoginAccount = {
  id: number;
  name: string;
  username: string;
  passwordHash: string;
};

export interface AdminLoginRepository {
  findActiveByEmailOrUsername(identifier: string): Promise<AdminLoginAccount | null>;
}

/** User is the verified shared Admin identity table; active status is mandatory. */
export class PrismaAdminLoginRepository implements AdminLoginRepository {
  public async findActiveByEmailOrUsername(identifier: string): Promise<AdminLoginAccount | null> {
    return getPrismaClient().user.findFirst({
      where: {
        status: Status.ACTIVE,
        OR: [{ email: identifier }, { username: identifier }],
      },
      select: { id: true, name: true, username: true, password: true },
    }).then((user) => user && ({ id: user.id, name: user.name, username: user.username, passwordHash: user.password }));
  }
}
