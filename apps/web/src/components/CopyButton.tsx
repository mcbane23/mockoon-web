import { useState } from 'react';
import { copyText } from '../lib/clipboard';
import { toastError } from '../store/app-store';
import { S } from '../strings';
import { Button } from './Button';

type CopyButtonProps = {
  text: string | (() => string);
  label?: string;
  /** Show the label next to the icon. */
  withText?: boolean;
};

export function CopyButton({ text, label = S.common.copy, withText = false }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    const ok = await copyText(typeof text === 'function' ? text() : text);
    if (!ok) {
      toastError(S.common.copyFailed);

      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Button
      size="small"
      variant="ghost"
      icon={copied ? 'check' : 'copy'}
      iconOnly={!withText}
      label={copied ? S.common.copied : label}
      onClick={() => void copy()}
    />
  );
}
