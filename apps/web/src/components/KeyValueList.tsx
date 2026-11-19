import { BuildHeader, type Header } from '@mockoon/commons';
import { useId } from 'react';
import { COMMON_CONTENT_TYPES, COMMON_HEADER_NAMES, S } from '../strings';
import { Button } from './Button';

type KeyValueListProps = {
  items: Header[];
  onChange: (items: Header[]) => void;
  addLabel?: string;
  emptyText?: string;
};

/** Editable list of key/value rows, used for response and environment headers. */
export function KeyValueList({
  items,
  onChange,
  addLabel = S.headers.add,
  emptyText = S.headers.empty,
}: KeyValueListProps) {
  const namesId = useId();
  const contentTypesId = useId();

  const update = (index: number, patch: Partial<Header>) =>
    onChange(items.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <datalist id={namesId}>
        {COMMON_HEADER_NAMES.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      <datalist id={contentTypesId}>
        {COMMON_CONTENT_TYPES.map((type) => (
          <option key={type} value={type} />
        ))}
      </datalist>

      {items.length === 0 && <div className="muted">{emptyText}</div>}
      {items.map((item, index) => (
        <div className="row" key={index} data-testid="kv-row">
          <input
            className="input"
            style={{ flex: '0 1 40%' }}
            aria-label={S.headers.key}
            placeholder={S.headers.key}
            list={namesId}
            value={item.key}
            spellCheck={false}
            onChange={(event) => update(index, { key: event.target.value })}
          />
          <input
            className="input grow"
            aria-label={S.headers.value}
            placeholder={S.headers.value}
            list={item.key.trim().toLowerCase() === 'content-type' ? contentTypesId : undefined}
            value={item.value}
            spellCheck={false}
            onChange={(event) => update(index, { value: event.target.value })}
          />
          <Button
            variant="ghost"
            icon="trash"
            iconOnly
            label={S.headers.remove}
            onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))}
          />
        </div>
      ))}
      <div>
        <Button icon="plus" size="small" onClick={() => onChange([...items, BuildHeader()])}>
          {addLabel}
        </Button>
      </div>
    </div>
  );
}
