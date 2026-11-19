import { useEffect, useId, useRef, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

type ModalProps = {
  title: string;
  onClose: () => void;
  /** When set the content is wrapped in a form and Enter submits. */
  onSubmit?: () => void;
  footer: ReactNode;
  children: ReactNode;
};

const FOCUSABLE =
  'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href]';

export function Modal({ title, onClose, onSubmit, footer, children }: ModalProps) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const container = ref.current;
    const first =
      container?.querySelector<HTMLElement>('[data-autofocus]') ??
      container?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    if (first instanceof HTMLInputElement) {
      first.select();
    }

    return () => previous?.focus?.();
  }, []);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();

      return;
    }
    if (event.key !== 'Tab' || !ref.current) {
      return;
    }
    // keep focus inside the dialog
    const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) {
      return;
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit?.();
  };

  const content = (
    <>
      <div className="modal-header" id={titleId}>
        {title}
      </div>
      <div className="modal-body">{children}</div>
      <div className="modal-footer">{footer}</div>
    </>
  );

  return createPortal(
    <div
      className="modal-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={ref}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
      >
        {onSubmit ? <form onSubmit={submit}>{content}</form> : content}
      </div>
    </div>,
    document.body,
  );
}
