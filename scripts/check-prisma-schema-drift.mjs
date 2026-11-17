#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const adminRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argumentIndex = process.argv.indexOf('--authoritative');
const configuredAuthoritativeRoot =
  argumentIndex >= 0 ? process.argv[argumentIndex + 1] : process.env.YC_FITNESS_API_PATH;
const authoritativeRoot = path.resolve(
  configuredAuthoritativeRoot ?? path.join(adminRoot, '..', 'ycfitness-api'),
);
const authoritativeSchemaPath = path.join(authoritativeRoot, 'prisma', 'schema.prisma');
const adminSchemaPath = path.join(adminRoot, 'prisma', 'schema.prisma');

const proposals = {
  blocks: new Set([
    'model:AttendanceQrCredential',
    'enum:AttendanceSource',
    'enum:AttendanceQrCredentialStatus',
  ]),
  extraFields: new Map([
    [
      'User',
      new Map([
        ['attendanceQrCredentialsCreated', 'attendanceQrCredentialsCreated AttendanceQrCredential[] @relation("AttendanceQrCredentialCreatedBy")'],
        ['attendanceQrCredentialsReplaced', 'attendanceQrCredentialsReplaced AttendanceQrCredential[] @relation("AttendanceQrCredentialReplacedBy")'],
        ['attendanceQrCredentialsRevoked', 'attendanceQrCredentialsRevoked AttendanceQrCredential[] @relation("AttendanceQrCredentialRevokedBy")'],
      ]),
    ],
    ['Attendance', new Map([['source', 'source AttendanceSource @default(LEGACY)']])],
  ]),
  fieldOverrides: new Map([
    [
      'Attendance.date',
      {
        authoritative: 'date String',
        admin: 'date String @default("")',
      },
    ],
  ]),
};

const fail = (message) => {
  console.error(`Schema drift check failed: ${message}`);
  process.exitCode = 1;
};

const readSchema = (schemaPath, label) => {
  try {
    return fs.readFileSync(schemaPath, 'utf8');
  } catch (error) {
    fail(`cannot read ${label} schema at ${schemaPath}: ${error.message}`);
    return null;
  }
};

const normalize = (line) => line.trim().replace(/\s+/g, ' ');

const parseBlocks = (source) => {
  const blocks = new Map();
  const expression = /^(model|enum)\s+(\w+)\s*\{([\s\S]*?)^\}/gm;

  for (const match of source.matchAll(expression)) {
    const [, kind, name, body] = match;
    const lines = body
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, ''))
      .map(normalize)
      .filter(Boolean);
    const entries = new Map();

    for (const line of lines) {
      const key = kind === 'enum' || line.startsWith('@@') ? line : line.split(' ')[0];
      if (entries.has(key)) throw new Error(`duplicate declaration ${kind} ${name}.${key}`);
      entries.set(key, line);
    }

    blocks.set(`${kind}:${name}`, { kind, name, entries });
  }

  return blocks;
};

const cloneEntries = (entries) => new Map(entries);

const compareEntries = (blockName, authoritativeEntries, adminEntries) => {
  const allKeys = [...new Set([...authoritativeEntries.keys(), ...adminEntries.keys()])].sort();
  const differences = [];

  for (const key of allKeys) {
    const authoritative = authoritativeEntries.get(key);
    const admin = adminEntries.get(key);
    if (authoritative !== admin) {
      differences.push(
        `${blockName}.${key}\n    authoritative: ${authoritative ?? '<missing>'}\n    admin:         ${admin ?? '<missing>'}`,
      );
    }
  }

  return differences;
};

const authoritativeSource = readSchema(authoritativeSchemaPath, 'authoritative');
const adminSource = readSchema(adminSchemaPath, 'Admin');

if (authoritativeSource && adminSource) {
  let authoritativeBlocks;
  let adminBlocks;

  try {
    authoritativeBlocks = parseBlocks(authoritativeSource);
    adminBlocks = parseBlocks(adminSource);
  } catch (error) {
    fail(error.message);
  }

  if (authoritativeBlocks && adminBlocks) {
    const differences = [];

    for (const [blockKey, authoritativeBlock] of authoritativeBlocks) {
      const adminBlock = adminBlocks.get(blockKey);
      if (!adminBlock) {
        differences.push(`${blockKey} is missing from the Admin schema`);
        continue;
      }

      const authoritativeEntries = cloneEntries(authoritativeBlock.entries);
      const adminEntries = cloneEntries(adminBlock.entries);
      const allowedExtras = proposals.extraFields.get(authoritativeBlock.name) ?? new Map();

      for (const [fieldName, expectedDeclaration] of allowedExtras) {
        const actual = adminEntries.get(fieldName);
        if (actual !== expectedDeclaration) {
          differences.push(
            `proposal ${authoritativeBlock.name}.${fieldName} changed\n    expected: ${expectedDeclaration}\n    actual:   ${actual ?? '<missing>'}`,
          );
        }
        adminEntries.delete(fieldName);
      }

      for (const [fieldKey, expected] of proposals.fieldOverrides) {
        const [modelName, fieldName] = fieldKey.split('.');
        if (modelName !== authoritativeBlock.name) continue;
        const authoritative = authoritativeEntries.get(fieldName);
        const admin = adminEntries.get(fieldName);
        if (authoritative !== expected.authoritative || admin !== expected.admin) {
          differences.push(
            `proposal override ${fieldKey} changed\n    expected authoritative: ${expected.authoritative}\n    actual authoritative:   ${authoritative ?? '<missing>'}\n    expected admin:         ${expected.admin}\n    actual admin:           ${admin ?? '<missing>'}`,
          );
        }
        authoritativeEntries.delete(fieldName);
        adminEntries.delete(fieldName);
      }

      differences.push(
        ...compareEntries(authoritativeBlock.name, authoritativeEntries, adminEntries),
      );
    }

    for (const blockKey of adminBlocks.keys()) {
      if (!authoritativeBlocks.has(blockKey) && !proposals.blocks.has(blockKey)) {
        differences.push(`${blockKey} exists only in Admin and is not a tracked proposal`);
      }
    }

    for (const proposalBlock of proposals.blocks) {
      if (!adminBlocks.has(proposalBlock)) {
        differences.push(`tracked proposal ${proposalBlock} is missing from the Admin schema`);
      }
    }

    if (differences.length > 0) {
      fail(`${differences.length} incompatible difference(s) found:\n\n- ${differences.join('\n- ')}`);
    } else {
      console.log('Prisma schema compatibility check passed.');
      console.log(`Authoritative schema: ${authoritativeSchemaPath}`);
      console.log(`Admin schema:         ${adminSchemaPath}`);
      console.log('Tracked Admin proposals:');
      console.log('  - AttendanceQrCredential model and relations');
      console.log('  - AttendanceSource enum and Attendance.source');
      console.log('  - AttendanceQrCredentialStatus enum');
      console.log('  - Attendance.date local proposal default');
    }
  }
}
