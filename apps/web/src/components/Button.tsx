import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'danger' | 'ghost';
  size?: 'small' | 'medium' | 'large';
  icon?: IconName;
  /** Icon-only button: the label becomes the accessible name and the tooltip. */
  iconOnly?: boolean;
  label?: string;
  children?: ReactNode;
};

export function Button({
  variant = 'default',
  size = 'medium',
  icon,
  iconOnly = false,
  label,
  children,
  className,
  type = 'button',
  ...rest
}: ButtonProps) {
  const classes = [
    'btn',
    variant !== 'default' ? `btn-${variant}` : '',
    size !== 'medium' ? `btn-${size}` : '',
    iconOnly ? 'btn-icon' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type={type}
      className={classes}
      aria-label={iconOnly ? label : undefined}
      title={iconOnly ? label : rest.title}
      {...rest}
    >
      {icon && <Icon name={icon} size={size === 'small' ? 14 : 16} />}
      {!iconOnly && (children ?? label)}
    </button>
  );
}
