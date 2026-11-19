import {
  EnvironmentSchema,
  HighestMigrationId,
  Migrations,
  repairRefs,
  type Environment,
  type PostMigrationAction,
} from '@mockoon/commons';
import { ApiError } from './errors.js';

export type LoadResult = {
  environment: Environment;
  /** Content differs from the file → should be saved. */
  migrated: boolean;
  disabledRoutesFromMigration: string[];
  collapsedFoldersFromMigration: string[];
};

/**
 * Turn raw text into a valid environment: parse, migrate, validate, repair references.
 * Mirrors the Mockoon CLI (migrateAndValidateEnvironment).
 *
 * EnvironmentSchema.validate *fixes* invalid values instead of failing, so the shape checks
 * before it are mandatory: without them any JSON would "open" as an empty environment.
 */
export function loadEnvironmentFromText(text: string): LoadResult {
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ApiError(422, 'INVALID_JSON', 'File is not valid JSON');
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ApiError(422, 'NOT_AN_ENVIRONMENT', 'File does not contain a Mockoon environment');
  }

  // Old Mockoon "export" format ({ source: 'mockoon:…', data: [...] }) is not supported.
  if (raw.source && Array.isArray(raw.data)) {
    throw new ApiError(
      422,
      'LEGACY_EXPORT_FORMAT',
      'Legacy Mockoon export files are not supported. Open it in Mockoon desktop and save as an environment file.',
    );
  }

  if (typeof raw.lastMigration !== 'number') {
    throw new ApiError(
      422,
      'NOT_AN_ENVIRONMENT',
      'Missing "lastMigration": not a Mockoon environment or too old',
    );
  }

  if (raw.lastMigration > HighestMigrationId) {
    throw new ApiError(
      422,
      'ENVIRONMENT_TOO_RECENT',
      `Environment was saved by a newer Mockoon version (migration ${raw.lastMigration} > ${HighestMigrationId})`,
    );
  }

  const original = JSON.stringify(raw);
  const actions: PostMigrationAction[] = [];
  const startMigration = raw.lastMigration;
  try {
    for (const migration of Migrations) {
      if (migration.id > raw.lastMigration) {
        const action = migration.migrationFunction(raw);
        if (action) {
          actions.push(action);
        }
        raw.lastMigration = migration.id;
      }
    }
  } catch (error) {
    throw new ApiError(
      422,
      'INVALID_ENVIRONMENT',
      `Environment could not be migrated: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const environment = validateEnvironment(raw);

  return {
    environment,
    migrated:
      startMigration !== environment.lastMigration || JSON.stringify(environment) !== original,
    disabledRoutesFromMigration: actions.flatMap((action) =>
      action.type === 'DISABLED_ROUTES_MIGRATION' ? action.disabledRoutesUuids : [],
    ),
    collapsedFoldersFromMigration: actions.flatMap((action) =>
      action.type === 'COLLAPSED_FOLDERS_MIGRATION' ? action.collapsedFoldersUuids : [],
    ),
  };
}

/** Schema validation (which fixes invalid values) followed by reference repair. */
export function validateEnvironment(raw: unknown): Environment {
  const { value, error } = EnvironmentSchema.validate(raw);
  if (error || !value) {
    throw new ApiError(422, 'INVALID_ENVIRONMENT', error?.message ?? 'Invalid environment');
  }

  return repairRefs(value as Environment);
}

/**
 * Validate an environment sent by a client. Clients always send the latest schema version, so
 * there is no migration branch.
 */
export function validateClientEnvironment(raw: unknown): {
  environment: Environment;
  fixed: boolean;
} {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ApiError(400, 'BAD_REQUEST', 'environment must be an object');
  }
  if ((raw as { lastMigration?: unknown }).lastMigration !== HighestMigrationId) {
    throw new ApiError(
      400,
      'BAD_REQUEST',
      `environment.lastMigration must be ${HighestMigrationId}`,
    );
  }

  const before = JSON.stringify(raw);
  let environment: Environment;
  try {
    // validate a copy: Joi and repairRefs may reuse or mutate nested objects
    environment = validateEnvironment(JSON.parse(before));
  } catch (error) {
    if (error instanceof ApiError) {
      throw new ApiError(400, 'BAD_REQUEST', error.message);
    }
    throw error;
  }

  return { environment, fixed: JSON.stringify(environment) !== before };
}
