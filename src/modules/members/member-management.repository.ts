import type { Gender, MemberRequestStatus, Prisma, Status } from '@prisma/client';
import { Prisma as PrismaValue, Status as StatusValue } from '@prisma/client';

import { getPrismaClient } from '../../database/prisma.js';
import { AppError } from '../../shared/app-error.js';
import type { MemberUpdateInput } from './member-management.schema.js';

type AdminSummary = { id: number; name: string };

export type MemberManagementRecord = {
  id: number;
  code: string;
  name: string;
  email: string | null;
  phone: string | null;
  countryCode: string | null;
  status: Status;
  clientType: string;
  language: string;
  theme: string;
  memberType: { id: number; name: string; status: Status } | null;
  profile: {
    address: string | null;
    bio: string | null;
    gender: Gender | null;
    age: number | null;
    yearOfExp: number | null;
    reason: string | null;
    hasProfilePhoto: boolean;
    hasCoverPhoto: boolean;
    hasCertificates: boolean;
    hasPhotos: boolean;
    createdAt: Date;
    updatedAt: Date;
  } | null;
  createdBy: AdminSummary | null;
  updatedBy: AdminSummary | null;
  createdAt: Date;
  updatedAt: Date;
  latestMemberRequest: {
    id: number;
    status: MemberRequestStatus;
    requestedMemberType: { id: number; name: string };
    requestedMemberPlan: { id: number; name: string; price: number; durationMonths: number };
    approvedAt: Date | null;
    rejectedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  } | null;
  shop: {
    id: number;
    name: string;
    status: Status;
    hasLogo: boolean;
    level: { id: number; name: string; status: Status } | null;
  } | null;
  attendance: { total: number; lastCheckedInAt: Date | null };
};

export type MemberMutationResult = { changed: boolean; member: MemberManagementRecord };

export interface MemberManagementRepository {
  findById(id: number): Promise<MemberManagementRecord | null>;
  update(id: number, actorUserId: number, input: MemberUpdateInput): Promise<MemberMutationResult>;
  setStatus(id: number, actorUserId: number, status: Status): Promise<MemberMutationResult>;
}

const memberSelect = {
  id: true,
  code: true,
  name: true,
  email: true,
  phone: true,
  countryCode: true,
  status: true,
  clientType: true,
  language: true,
  theme: true,
  memberType: { select: { id: true, name: true, status: true } },
  profile: {
    select: {
      address: true,
      bio: true,
      gender: true,
      age: true,
      yearOfExp: true,
      reason: true,
      profilePhoto: true,
      profilePhotoKey: true,
      coverPhoto: true,
      coverPhotoKey: true,
      certificates: true,
      photos: true,
      createdAt: true,
      updatedAt: true,
    },
  },
  createdBy: { select: { id: true, name: true } },
  updatedBy: { select: { id: true, name: true } },
  createdAt: true,
  updatedAt: true,
  memberRequests: {
    select: {
      id: true,
      status: true,
      approvedAt: true,
      rejectedAt: true,
      createdAt: true,
      updatedAt: true,
      memberType: { select: { id: true, name: true } },
      memberPlan: { select: { id: true, name: true, price: true, duration: true } },
    },
    orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
    take: 1,
  },
  shop: {
    select: {
      id: true,
      name: true,
      logo: true,
      status: true,
      shopLevel: { select: { id: true, name: true, status: true } },
    },
  },
  attendances: {
    select: { createdAt: true },
    orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
    take: 1,
  },
  _count: { select: { attendances: true } },
} satisfies Prisma.MemberSelect;

type SelectedMember = Prisma.MemberGetPayload<{ select: typeof memberSelect }>;

const hasJsonContent = (value: Prisma.JsonValue | null): boolean => {
  if (value === null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
};

const toRecord = (member: SelectedMember): MemberManagementRecord => {
  const request = member.memberRequests[0];
  return {
    id: member.id,
    code: member.code,
    name: member.name,
    email: member.email,
    phone: member.phone,
    countryCode: member.countryCode,
    status: member.status,
    clientType: member.clientType,
    language: member.language,
    theme: member.theme,
    memberType: member.memberType,
    profile: member.profile ? {
      address: member.profile.address,
      bio: member.profile.bio,
      gender: member.profile.gender,
      age: member.profile.age,
      yearOfExp: member.profile.yearOfExp,
      reason: member.profile.reason,
      hasProfilePhoto: Boolean(member.profile.profilePhoto || member.profile.profilePhotoKey),
      hasCoverPhoto: Boolean(member.profile.coverPhoto || member.profile.coverPhotoKey),
      hasCertificates: hasJsonContent(member.profile.certificates),
      hasPhotos: hasJsonContent(member.profile.photos),
      createdAt: member.profile.createdAt,
      updatedAt: member.profile.updatedAt,
    } : null,
    createdBy: member.createdBy,
    updatedBy: member.updatedBy,
    createdAt: member.createdAt,
    updatedAt: member.updatedAt,
    latestMemberRequest: request ? {
      id: request.id,
      status: request.status,
      requestedMemberType: request.memberType,
      requestedMemberPlan: {
        id: request.memberPlan.id,
        name: request.memberPlan.name,
        price: request.memberPlan.price,
        durationMonths: request.memberPlan.duration,
      },
      approvedAt: request.approvedAt,
      rejectedAt: request.rejectedAt,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
    } : null,
    shop: member.shop ? {
      id: member.shop.id,
      name: member.shop.name,
      status: member.shop.status,
      hasLogo: Boolean(member.shop.logo),
      level: member.shop.shopLevel,
    } : null,
    attendance: {
      total: member._count.attendances,
      lastCheckedInAt: member.attendances[0]?.createdAt ?? null,
    },
  };
};

const notFound = () => new AppError({ statusCode: 404, code: 'NOT_FOUND', message: 'Member was not found.' });

const mapMutationError = (error: unknown): never => {
  if (error instanceof AppError) throw error;
  if (error instanceof PrismaValue.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      const target = JSON.stringify(error.meta ?? {}).toLowerCase();
      const field = target.includes('email') ? 'email' : target.includes('phone') ? 'phone' : 'identity';
      throw new AppError({
        statusCode: 409,
        code: 'MEMBER_IDENTITY_CONFLICT',
        message: `Another member already uses this ${field}.`,
        details: { field },
      });
    }
    if (error.code === 'P2025') throw notFound();
  }
  throw error;
};

export class PrismaMemberManagementRepository implements MemberManagementRepository {
  public async findById(id: number): Promise<MemberManagementRecord | null> {
    const member = await getPrismaClient().member.findUnique({ where: { id }, select: memberSelect });
    return member ? toRecord(member) : null;
  }

  public async update(id: number, actorUserId: number, input: MemberUpdateInput): Promise<MemberMutationResult> {
    const profileKeys = ['address', 'bio', 'gender', 'age'] as const;
    const hasProfileUpdate = profileKeys.some((key) => Object.prototype.hasOwnProperty.call(input, key));
    const memberData: Prisma.MemberUncheckedUpdateInput = {
      updatedById: actorUserId,
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.email === undefined ? {} : { email: input.email }),
      ...(input.phone === undefined ? {} : { phone: input.phone }),
    };
    const profileData: Pick<Prisma.MemberProfileUncheckedCreateInput, 'address' | 'bio' | 'gender' | 'age'> = {
      ...(input.address === undefined ? {} : { address: input.address }),
      ...(input.bio === undefined ? {} : { bio: input.bio }),
      ...(input.gender === undefined ? {} : { gender: input.gender }),
      ...(input.age === undefined ? {} : { age: input.age }),
    };

    try {
      const prisma = getPrismaClient();
      await prisma.$transaction(async (transaction) => {
        const exists = await transaction.member.findUnique({ where: { id }, select: { id: true } });
        if (!exists) throw notFound();
        await transaction.member.update({ where: { id }, data: memberData, select: { id: true } });
        if (hasProfileUpdate) {
          await transaction.memberProfile.upsert({
            where: { memberId: id },
            create: { memberId: id, ...profileData },
            update: profileData,
          });
        }
      });
      const member = await this.findById(id);
      if (!member) throw notFound();
      return { changed: true, member };
    } catch (error) {
      return mapMutationError(error);
    }
  }

  public async setStatus(id: number, actorUserId: number, status: Status): Promise<MemberMutationResult> {
    try {
      const prisma = getPrismaClient();
      const changed = await prisma.member.updateMany({
        where: { id, status: { not: status } },
        data: { status, updatedById: actorUserId },
      });
      const member = await this.findById(id);
      if (!member) throw notFound();
      return { changed: changed.count === 1, member };
    } catch (error) {
      return mapMutationError(error);
    }
  }
}

export const activeMemberStatus = StatusValue.ACTIVE;
export const inactiveMemberStatus = StatusValue.INACTIVE;
