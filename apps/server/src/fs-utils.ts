import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const sha256 = (text: string | Buffer): string =>
  createHash('sha256').update(text).digest('hex');

/** Write to a temporary file in the same directory, then rename over the target. */
export async function writeFileAtomic(
  filePath: string,
  text: string,
  mode?: number,
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp-${process.pid}`;
  try {
    await fs.writeFile(tmpPath, text, { encoding: 'utf8', mode });
    await fs.rename(tmpPath, filePath);
  } catch (error) {
    await fs.rm(tmpPath, { force: true }).catch(() => {});
    throw error;
  }
}

export const isENOENT = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: string }).code === 'ENOENT';

/** Lower-case, everything outside a-z0-9 becomes "-", at most 40 chars, never empty. */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');

  return slug || 'environment';
}

export const isInsideDirectory = (directory: string, filePath: string): boolean => {
  const relative = path.relative(directory, filePath);

  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
};
