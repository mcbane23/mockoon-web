import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { S } from '../strings';
import { Button, type ButtonProps } from './Button';

export type MenuItem =
  | {
      label: string;
      onSelect: () => void;
      danger?: boolean;
      disabled?: boolean;
      /** Two-step confirmation: the first click turns the item into "Confirm". */
      confirm?: boolean;
    }
  | 'separator';

type MenuListProps = {
  /** Viewport coordinates of the top-left corner. */
  position: { x: number; y: number };
  items: MenuItem[];
  onClose: () => void;
  label?: string;
};

const CONFIRM_REVERT_MS = 4000;

/** Floating menu at a fixed position. Closes on outside click, Escape, scroll and resize. */
export function MenuList({ position, items, onClose, label }: MenuListProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState(position);
  const [armed, setArmed] = useState<number | null>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    // keep the menu inside the viewport
    const rect = element.getBoundingClientRect();
    setCoords({
      x: Math.max(4, Math.min(position.x, window.innerWidth - rect.width - 4)),
      y: Math.max(4, Math.min(position.y, window.innerHeight - rect.height - 4)),
    });
    element.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
  }, [position]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) {
        onClose();
      }
    };
    const close = () => onClose();
    document.addEventListener('mousedown', onPointerDown, true);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);

    return () => {
      document.removeEventListener('mousedown', onPointerDown, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
    };
  }, [onClose]);

  useEffect(() => {
    if (armed === null) {
      return;
    }
    const timer = setTimeout(() => setArmed(null), CONFIRM_REVERT_MS);

    return () => clearTimeout(timer);
  }, [armed]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault();
      event.stopPropagation();
      onClose();

      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
      return;
    }
    event.preventDefault();
    const buttons = [
      ...(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? []),
    ];
    const index = buttons.indexOf(document.activeElement as HTMLElement);
    const next =
      event.key === 'ArrowDown'
        ? (index + 1) % buttons.length
        : (index - 1 + buttons.length) % buttons.length;
    buttons[next]?.focus();
  };

  return createPortal(
    <div
      ref={ref}
      className="menu"
      role="menu"
      aria-label={label}
      style={{ left: coords.x, top: coords.y }}
      onKeyDown={onKeyDown}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item, index) =>
        item === 'separator' ? (
          <div key={index} className="menu-separator" role="separator" />
        ) : (
          <button
            key={index}
            type="button"
            role="menuitem"
            className={`menu-item${item.danger || armed === index ? ' danger' : ''}`}
            disabled={item.disabled}
            onClick={() => {
              if (item.confirm && armed !== index) {
                setArmed(index);

                return;
              }
              onClose();
              item.onSelect();
            }}
          >
            {armed === index ? S.common.confirm : item.label}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}

type MenuButtonProps = Omit<ButtonProps, 'onClick'> & {
  items: MenuItem[] | (() => MenuItem[]);
  children?: ReactNode;
};

/** Button that opens a menu below itself. */
export function MenuButton({ items, ...button }: MenuButtonProps) {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);

  return (
    <span ref={ref} style={{ display: 'inline-flex' }}>
      <Button
        {...button}
        aria-haspopup="menu"
        aria-expanded={position !== null}
        onClick={(event) => {
          event.stopPropagation();
          const rect = event.currentTarget.getBoundingClientRect();
          setPosition(position ? null : { x: rect.left, y: rect.bottom + 4 });
        }}
      />
      {position && (
        <MenuList
          position={position}
          items={typeof items === 'function' ? items() : items}
          label={button.label}
          onClose={() => {
            setPosition(null);
            ref.current?.querySelector('button')?.focus();
          }}
        />
      )}
    </span>
  );
}
