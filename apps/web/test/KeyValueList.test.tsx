import type { Header } from '@mockoon/commons';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { KeyValueList } from '../src/components/KeyValueList';
import { addMissingCorsHeaders } from '../src/features/env-settings/EnvSettingsPage';

function Harness({ initial = [] }: { initial?: Header[] }) {
  const [items, setItems] = useState(initial);

  return (
    <>
      <KeyValueList items={items} onChange={setItems} />
      <output data-testid="state">{JSON.stringify(items)}</output>
    </>
  );
}

const readState = () => JSON.parse(screen.getByTestId('state').textContent ?? '[]') as Header[];

describe('KeyValueList', () => {
  it('adds rows', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.getByText('No headers')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add header' }));
    expect(screen.getAllByTestId('kv-row')).toHaveLength(1);
    expect(readState()).toEqual([{ key: '', value: '' }]);
    expect(screen.queryByText('No headers')).not.toBeInTheDocument();
  });

  it('edits keys and values', async () => {
    const user = userEvent.setup();
    render(<Harness initial={[{ key: 'Content-Type', value: 'text/plain' }]} />);

    await user.click(screen.getByRole('button', { name: 'Add header' }));
    await user.type(screen.getAllByLabelText('Header name')[1]!, 'X-Request-Id');
    await user.type(screen.getAllByLabelText('Header value')[1]!, '42');
    const firstValue = screen.getAllByLabelText('Header value')[0]!;
    await user.clear(firstValue);
    await user.type(firstValue, 'application/json');

    expect(readState()).toEqual([
      { key: 'Content-Type', value: 'application/json' },
      { key: 'X-Request-Id', value: '42' },
    ]);
  });

  it('suggests content types only for the Content-Type header', () => {
    render(
      <Harness
        initial={[
          { key: 'content-type', value: '' },
          { key: 'ETag', value: '' },
        ]}
      />,
    );
    const [contentType, other] = screen.getAllByLabelText('Header value');

    expect(contentType).toHaveAttribute('list');
    expect(other).not.toHaveAttribute('list');
    expect(screen.getAllByLabelText('Header name')[0]).toHaveAttribute('list');
  });

  it('removes the right row', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initial={[
          { key: 'A', value: '1' },
          { key: 'B', value: '2' },
          { key: 'C', value: '3' },
        ]}
      />,
    );

    await user.click(screen.getAllByRole('button', { name: 'Remove header' })[1]!);
    expect(readState()).toEqual([
      { key: 'A', value: '1' },
      { key: 'C', value: '3' },
    ]);
    expect(screen.getAllByTestId('kv-row')).toHaveLength(2);
  });
});

describe('addMissingCorsHeaders', () => {
  it('adds only the CORS headers that are missing, ignoring case', () => {
    const headers: Header[] = [
      { key: 'Content-Type', value: 'application/json' },
      { key: 'access-control-allow-origin', value: 'https://example.org' },
    ];
    const result = addMissingCorsHeaders(headers);

    expect(result.slice(0, 2)).toEqual(headers);
    expect(result.map((header) => header.key.toLowerCase())).toEqual([
      'content-type',
      'access-control-allow-origin',
      'access-control-allow-methods',
      'access-control-allow-headers',
    ]);
    // nothing to add the second time
    expect(addMissingCorsHeaders(result)).toBe(result);
  });
});
