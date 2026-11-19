import { html } from '@codemirror/lang-html';
import { json } from '@codemirror/lang-json';
import { xml } from '@codemirror/lang-xml';
import CodeMirror, { EditorView } from '@uiw/react-codemirror';
import { useEffect, useMemo, useState } from 'react';
import type { EditorLanguage } from '../lib/content-type';

type CodeEditorProps = {
  value: string;
  onChange?: (value: string) => void;
  language: EditorLanguage;
  ariaLabel: string;
  readOnly?: boolean;
  minHeight?: string;
  maxHeight?: string;
};

function usePrefersDark(): boolean {
  const [dark, setDark] = useState(
    () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false,
  );
  useEffect(() => {
    const query = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!query) {
      return;
    }
    const listener = (event: MediaQueryListEvent) => setDark(event.matches);
    query.addEventListener('change', listener);

    return () => query.removeEventListener('change', listener);
  }, []);

  return dark;
}

/**
 * CodeMirror editor with syntax highlighting. JSON syntax errors are intentionally not reported:
 * bodies routinely contain {{templating}} that is not valid JSON.
 */
export function CodeEditor({
  value,
  onChange,
  language,
  ariaLabel,
  readOnly = false,
  minHeight = '220px',
  maxHeight = '55vh',
}: CodeEditorProps) {
  const dark = usePrefersDark();
  const extensions = useMemo(() => {
    const base = [
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ 'aria-label': ariaLabel }),
    ];
    if (language === 'json') {
      return [...base, json()];
    }
    if (language === 'xml') {
      return [...base, xml()];
    }
    if (language === 'html') {
      return [...base, html()];
    }

    return base;
  }, [language, ariaLabel]);

  return (
    <CodeMirror
      value={value}
      theme={dark ? 'dark' : 'light'}
      extensions={extensions}
      readOnly={readOnly}
      editable={!readOnly}
      minHeight={minHeight}
      maxHeight={maxHeight}
      basicSetup={{ foldGutter: true, highlightActiveLine: !readOnly, autocompletion: false }}
      onChange={onChange}
      style={{
        border: '1px solid var(--border-strong)',
        borderRadius: 'var(--radius)',
        overflow: 'hidden',
        fontSize: 12,
      }}
    />
  );
}
