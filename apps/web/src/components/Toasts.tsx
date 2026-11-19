import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../store/app-store';
import { S } from '../strings';
import { Button } from './Button';

/** Toast messages, bottom right. Timing and the limit of 4 live in the store. */
export function Toasts() {
  const toasts = useAppStore((store) => store.toasts);
  const dismiss = useAppStore((store) => store.dismissToast);
  const navigate = useNavigate();

  return (
    <div className="toasts" role="region" aria-label="Notifications" aria-live="polite">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`toast toast-${toast.kind}`}
          role={toast.kind === 'error' ? 'alert' : 'status'}
        >
          <div className="grow">{toast.message}</div>
          {toast.action && (
            <Button
              size="small"
              onClick={() => {
                navigate(toast.action!.to);
                dismiss(toast.id);
              }}
            >
              {toast.action.label}
            </Button>
          )}
          <Button
            size="small"
            variant="ghost"
            icon="close"
            iconOnly
            label={S.common.dismiss}
            onClick={() => dismiss(toast.id)}
          />
        </div>
      ))}
    </div>
  );
}
