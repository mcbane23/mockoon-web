import type { ApiErrorBody } from '@maketa/shared';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  toBody(): ApiErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details === undefined ? {} : { details: this.details }),
      },
    };
  }
}

export const notFound = (uuid: string) =>
  new ApiError(404, 'NOT_FOUND', `Environment ${uuid} does not exist`);

export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
