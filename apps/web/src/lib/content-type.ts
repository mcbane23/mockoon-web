export type EditorLanguage = 'json' | 'xml' | 'html' | 'text';

/** Editor language for a Content-Type value. */
export function languageForContentType(contentType: string | null | undefined): EditorLanguage {
  const value = (contentType ?? '').toLowerCase();
  if (value.includes('json')) {
    return 'json';
  }
  if (value.includes('html')) {
    return 'html';
  }
  if (value.includes('xml')) {
    return 'xml';
  }

  return 'text';
}

/** Pretty-print JSON with 2 spaces. Returns null when the text is not valid JSON. */
export function prettifyJson(text: string): string | null {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return null;
  }
}
