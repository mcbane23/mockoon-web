import { useEffect, useId, useState, type InputHTMLAttributes, type ReactNode } from 'react';

type ValidatedInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange' | 'className'
> & {
  label: string;
  /** Current saved value. */
  value: string;
  /** Returns an error message or null. */
  validate?: (value: string) => string | null;
  /** Called with a valid value that differs from the saved one. */
  onCommit: (value: string) => void;
  /**
   * "input": apply on every keystroke. "blur": apply on blur or Enter (Escape reverts), for
   * fields where every intermediate value would be expensive (a port change restarts the mock).
   */
  commitOn?: 'input' | 'blur';
  /** Normalise the text before validation and commit (e.g. strip slashes). */
  normalize?: (value: string) => string;
  help?: ReactNode;
  warning?: ReactNode;
  mono?: boolean;
};

/** Text field with validation. An invalid value gets a red border and a message and is not saved. */
export function ValidatedInput({
  label,
  value,
  validate,
  onCommit,
  commitOn = 'input',
  normalize,
  help,
  warning,
  mono,
  ...input
}: ValidatedInputProps) {
  const [draft, setDraft] = useState(value);
  const helpId = useId();

  // follow external changes (reload, another client, revert by the server)
  useEffect(() => {
    setDraft(value);
  }, [value]);

  const error = validate ? validate(normalize ? normalize(draft) : draft) : null;

  const commit = (text: string) => {
    const next = normalize ? normalize(text) : text;
    if (validate?.(next)) {
      return;
    }
    if (next !== text) {
      setDraft(next);
    }
    if (next !== value) {
      onCommit(next);
    }
  };

  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input
        {...input}
        className={`input${mono ? ' mono' : ''}`}
        value={draft}
        aria-invalid={error !== null}
        aria-describedby={helpId}
        onChange={(event) => {
          setDraft(event.target.value);
          if (commitOn === 'input') {
            const next = normalize ? normalize(event.target.value) : event.target.value;
            if (!validate?.(next) && next !== value) {
              onCommit(next);
            }
          }
        }}
        onBlur={() => commit(draft)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            commit(draft);
          } else if (event.key === 'Escape' && commitOn === 'blur') {
            setDraft(value);
          }
        }}
      />
      <span id={helpId}>
        {error ? (
          <span className="field-error" role="alert">
            {error}
          </span>
        ) : warning ? (
          <span className="field-error" style={{ color: 'var(--warning)' }}>
            {warning}
          </span>
        ) : help ? (
          <span className="field-help">{help}</span>
        ) : null}
      </span>
    </label>
  );
}
