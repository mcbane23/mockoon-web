import type { ReactNode } from 'react';

type ToggleProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  /** Hide the label visually but keep it for screen readers. */
  hideLabel?: boolean;
  disabled?: boolean;
};

export function Toggle({ checked, onChange, label, hideLabel = false, disabled }: ToggleProps) {
  return (
    <label className="toggle">
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className={hideLabel ? 'sr-only' : undefined}>{label}</span>
    </label>
  );
}
