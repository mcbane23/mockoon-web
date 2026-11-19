import { useEffect, useState } from 'react';
import { S } from '../strings';
import { Button, type ButtonProps } from './Button';

const REVERT_MS = 4000;

type ConfirmButtonProps = Omit<ButtonProps, 'onClick'> & {
  label: string;
  onConfirm: () => void;
};

/** Two-step confirmation on the same button: "Delete" → "Confirm", reverting after 4 s. */
export function ConfirmButton({ label, onConfirm, iconOnly, ...rest }: ConfirmButtonProps) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) {
      return;
    }
    const timer = setTimeout(() => setArmed(false), REVERT_MS);

    return () => clearTimeout(timer);
  }, [armed]);

  return (
    <Button
      {...rest}
      variant={armed ? 'danger' : rest.variant}
      iconOnly={armed ? false : iconOnly}
      label={armed ? S.common.confirm : label}
      onBlur={() => setArmed(false)}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else {
          setArmed(true);
        }
      }}
    />
  );
}
