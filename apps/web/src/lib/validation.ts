import { S } from '../strings';

export const NAME_MAX_LENGTH = 100;

/** Returns an error message, or null when the value is valid. */
export function validatePort(value: string | number, uiPort?: number): string | null {
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) {
    return S.validation.portRange;
  }
  const port = Number(text);
  if (port < 1 || port > 65535) {
    return S.validation.portRange;
  }
  if (uiPort !== undefined && port === uiPort) {
    return S.validation.portIsUi(port);
  }

  return null;
}

export function validateName(value: string): string | null {
  const name = value.trim();
  if (!name) {
    return S.validation.nameRequired;
  }
  if (name.length > NAME_MAX_LENGTH) {
    return S.validation.nameTooLong(NAME_MAX_LENGTH);
  }

  return null;
}

/** API prefix is stored without leading and trailing slashes. */
export function normalizePrefix(value: string): string {
  return value.trim().replace(/^\/+/, '').replace(/\/+$/, '');
}

export function validateNonNegativeInteger(value: string | number): string | null {
  const text = String(value).trim();

  return /^\d+$/.test(text) ? null : S.validation.nonNegative;
}

export function validateIntegerInRange(
  value: string | number,
  min: number,
  max: number,
): string | null {
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) {
    return S.validation.range(min, max);
  }
  const number = Number(text);

  return number < min || number > max ? S.validation.range(min, max) : null;
}

export function regexError(pattern: string): string | null {
  try {
    new RegExp(pattern);

    return null;
  } catch (error) {
    return error instanceof Error ? error.message : S.validation.invalidRegex;
  }
}
