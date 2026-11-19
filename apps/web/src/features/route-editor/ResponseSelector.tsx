import { ReorderActionType, type Route, type RouteResponse } from '@mockoon/commons';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../components/Icon';
import { SortableList } from '../../components/SortableList';
import { statusClass } from '../../lib/method';
import { S } from '../../strings';
import styles from './RouteEditor.module.css';

type Props = {
  route: Route;
  selected: RouteResponse;
  onSelect: (uuid: string) => void;
  onReorder: (sourceUuid: string, targetUuid: string, type: ReorderActionType) => void;
};

function Summary({ response }: { response: RouteResponse }) {
  return (
    <>
      <span className={styles.flag} aria-hidden={!response.default}>
        {response.default && (
          <span role="img" aria-label={S.responses.isDefault} title={S.responses.isDefault}>
            <Icon name="flag" size={14} />
          </span>
        )}
      </span>
      <strong className={statusClass(response.statusCode)}>{response.statusCode}</strong>
      <span className="truncate grow">{response.label}</span>
      {response.rules.length > 0 && (
        <span className="badge">{S.responses.rulesCount(response.rules.length)}</span>
      )}
    </>
  );
}

/** Dropdown with all responses of a route. Rows can be dragged: rules are checked from the top. */
export function ResponseSelector({ route, selected, onSelect, onReorder }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onMouseDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onMouseDown);

    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  const ids = route.responses.map((response) => response.uuid);

  return (
    <div
      ref={ref}
      className={styles.selector}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        className={`btn ${styles.selectorButton}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={S.responses.select}
        onClick={() => setOpen(!open)}
      >
        <Summary response={selected} />
        <Icon name="chevronDown" size={14} />
      </button>
      {open && (
        <div className={styles.selectorList} role="listbox" aria-label={S.responses.title}>
          <SortableList
            ids={ids}
            onMove={(from, to) => {
              const source = ids[from];
              const target = ids[to];
              if (source && target) {
                onReorder(
                  source,
                  target,
                  from < to ? ReorderActionType.AFTER : ReorderActionType.BEFORE,
                );
              }
            }}
          >
            {({ id, handleProps }) => {
              const response = route.responses.find((item) => item.uuid === id);
              if (!response) {
                return null;
              }

              return (
                <div
                  className={`${styles.option}${id === selected.uuid ? ` ${styles.optionSelected}` : ''}`}
                >
                  <span
                    {...handleProps}
                    className={styles.optionHandle}
                    aria-label={S.common.dragToReorder}
                    title={S.common.dragToReorder}
                  >
                    <Icon name="drag" size={14} />
                  </span>
                  <button
                    type="button"
                    role="option"
                    aria-selected={id === selected.uuid}
                    className={styles.optionButton}
                    onClick={() => {
                      onSelect(id);
                      setOpen(false);
                    }}
                  >
                    <Summary response={response} />
                  </button>
                </div>
              );
            }}
          </SortableList>
        </div>
      )}
    </div>
  );
}
