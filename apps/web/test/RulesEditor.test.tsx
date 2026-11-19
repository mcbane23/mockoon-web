import { BuildResponseRule, ResponseMode, type ResponseRule } from '@mockoon/commons';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { RulesEditor, type RulesPatch } from '../src/features/route-editor/RulesEditor';

type HarnessProps = {
  initial?: ResponseRule[];
  responseMode?: ResponseMode | null;
  onPatch?: (patch: RulesPatch) => void;
};

/** Keeps the rules in state the way the route editor does. */
function Harness({ initial = [], responseMode = null, onPatch }: HarnessProps) {
  const [state, setState] = useState<{ rules: ResponseRule[]; rulesOperator: 'OR' | 'AND' }>({
    rules: initial,
    rulesOperator: 'OR',
  });

  return (
    <>
      <RulesEditor
        rules={state.rules}
        rulesOperator={state.rulesOperator}
        responseMode={responseMode}
        onChange={(patch) => {
          onPatch?.(patch);
          setState((current) => ({ ...current, ...patch }));
        }}
      />
      <output data-testid="state">{JSON.stringify(state)}</output>
    </>
  );
}

const readState = () =>
  JSON.parse(screen.getByTestId('state').textContent ?? '{}') as {
    rules: ResponseRule[];
    rulesOperator: string;
  };

const rule = (partial: Partial<ResponseRule>): ResponseRule => ({
  ...BuildResponseRule(),
  ...partial,
});

describe('RulesEditor', () => {
  it('adds and removes rules', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.queryAllByTestId('rule-row')).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Add rule' }));
    await user.click(screen.getByRole('button', { name: 'Add rule' }));
    expect(screen.getAllByTestId('rule-row')).toHaveLength(2);
    expect(readState().rules).toEqual([BuildResponseRule(), BuildResponseRule()]);

    await user.type(screen.getAllByLabelText('Modifier')[0]!, 'user.name');
    await user.type(screen.getAllByLabelText('Value')[1]!, 'second');
    await user.click(screen.getAllByRole('button', { name: 'Remove rule' })[0]!);

    expect(screen.getAllByTestId('rule-row')).toHaveLength(1);
    expect(readState().rules).toEqual([rule({ value: 'second' })]);
  });

  it('offers every target and operator of the engine', () => {
    render(<Harness initial={[rule({})]} />);
    const targets = within(screen.getByLabelText('Target')).getAllByRole('option');
    const operators = within(screen.getByLabelText('Operator')).getAllByRole('option');

    expect(targets.map((option) => (option as HTMLOptionElement).value)).toEqual([
      'body',
      'query',
      'header',
      'cookie',
      'params',
      'path',
      'method',
      'request_number',
      'global_var',
      'data_bucket',
      'templating',
    ]);
    expect(operators.map((option) => (option as HTMLOptionElement).value)).toEqual([
      'equals',
      'regex',
      'regex_i',
      'null',
      'empty_array',
      'array_includes',
      'valid_json_schema',
    ]);
  });

  it('hides the modifier for targets that have none', async () => {
    const user = userEvent.setup();
    render(<Harness initial={[rule({ target: 'header' })]} />);
    expect(screen.getByLabelText('Modifier')).toHaveAttribute('placeholder', 'Header name');

    for (const target of ['path', 'method', 'request_number']) {
      await user.selectOptions(screen.getByLabelText('Target'), target);
      expect(screen.queryByLabelText('Modifier')).not.toBeInTheDocument();
    }
    expect(screen.getByLabelText('Value')).toHaveAttribute('placeholder', '1');

    await user.selectOptions(screen.getByLabelText('Target'), 'cookie');
    expect(screen.getByLabelText('Modifier')).toHaveAttribute('placeholder', 'Cookie name');
    expect(readState().rules[0]?.target).toBe('cookie');
  });

  it('hides the value for operators that need none', async () => {
    const user = userEvent.setup();
    render(<Harness initial={[rule({ target: 'header', modifier: 'Authorization' })]} />);
    expect(screen.getByLabelText('Value')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Operator'), 'null');
    expect(screen.queryByLabelText('Value')).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Operator'), 'empty_array');
    expect(screen.queryByLabelText('Value')).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Operator'), 'valid_json_schema');
    expect(screen.getByLabelText('Value')).toHaveAttribute(
      'placeholder',
      'Path to a JSON schema in a data bucket',
    );
    expect(readState().rules[0]).toMatchObject({
      target: 'header',
      modifier: 'Authorization',
      operator: 'valid_json_schema',
    });
  });

  it('marks an invalid regex but still saves it', async () => {
    const user = userEvent.setup();
    render(<Harness initial={[rule({ operator: 'regex' })]} />);
    const value = screen.getByLabelText('Value');

    await user.type(value, '(abc');
    expect(value).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid regular expression');
    expect(readState().rules[0]?.value).toBe('(abc');

    await user.type(value, ')');
    expect(value).toHaveAttribute('aria-invalid', 'false');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    // no validation for other operators
    await user.clear(value);
    await user.type(value, '(');
    await user.selectOptions(screen.getByLabelText('Operator'), 'equals');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('toggles invert', async () => {
    const user = userEvent.setup();
    render(<Harness initial={[rule({})]} />);
    const invert = screen.getByRole('button', { name: 'Invert' });

    expect(invert).toHaveAttribute('aria-pressed', 'false');
    await user.click(invert);
    expect(invert).toHaveAttribute('aria-pressed', 'true');
    expect(readState().rules[0]?.invert).toBe(true);
  });

  it('AND/OR between rows changes rulesOperator', async () => {
    const user = userEvent.setup();
    const onPatch = vi.fn();
    render(<Harness initial={[rule({}), rule({}), rule({})]} onPatch={onPatch} />);

    // one switch between each pair of rows, all bound to the same value
    const switches = screen.getAllByRole('button', { name: /Combine rules with/ });
    expect(switches).toHaveLength(2);
    expect(switches[0]).toHaveTextContent('OR');

    await user.click(switches[1]!);
    expect(onPatch).toHaveBeenLastCalledWith({ rulesOperator: 'AND' });
    expect(readState().rulesOperator).toBe('AND');
    screen
      .getAllByRole('button', { name: /Combine rules with/ })
      .forEach((button) => expect(button).toHaveTextContent('AND'));

    await user.click(screen.getAllByRole('button', { name: /Combine rules with/ })[0]!);
    expect(readState().rulesOperator).toBe('OR');
  });

  it('explains when the response mode ignores rules', () => {
    const { rerender } = render(<Harness responseMode={ResponseMode.SEQUENTIAL} />);
    expect(screen.getByRole('note')).toHaveTextContent(
      'Rules are not used while the response mode is "Sequential".',
    );

    rerender(<Harness responseMode={ResponseMode.FALLBACK} />);
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });
});
