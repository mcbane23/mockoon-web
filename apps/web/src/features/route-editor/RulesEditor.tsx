import {
  BuildResponseRule,
  ResponseMode,
  type LogicalOperators,
  type ResponseRule,
  type ResponseRuleOperators,
  type ResponseRuleTargets,
} from '@mockoon/commons';
import { Fragment } from 'react';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { SortableList, arrayMove } from '../../components/SortableList';
import { regexError } from '../../lib/validation';
import { S } from '../../strings';
import styles from './RulesEditor.module.css';

const TARGETS = Object.keys(S.rules.targets) as ResponseRuleTargets[];
const OPERATORS = Object.keys(S.rules.operators) as ResponseRuleOperators[];

const NO_MODIFIER: ReadonlySet<ResponseRuleTargets> = new Set(['path', 'method', 'request_number']);
const NO_VALUE: ReadonlySet<ResponseRuleOperators> = new Set(['null', 'empty_array']);

const MODE_LABELS: Partial<Record<ResponseMode, string>> = {
  [ResponseMode.RANDOM]: S.route.modes.random.label,
  [ResponseMode.SEQUENTIAL]: S.route.modes.sequential.label,
  [ResponseMode.DISABLE_RULES]: S.route.modes.disableRules.label,
};

const modifierPlaceholder = (target: ResponseRuleTargets): string => {
  switch (target) {
    case 'header':
      return S.rules.modifierPlaceholders.header;
    case 'cookie':
      return S.rules.modifierPlaceholders.cookie;
    case 'params':
      return S.rules.modifierPlaceholders.params;
    case 'templating':
      return S.rules.modifierPlaceholders.templating;
    default:
      return S.rules.modifierPlaceholders.path;
  }
};

const valuePlaceholder = (rule: ResponseRule): string => {
  if (rule.operator === 'valid_json_schema') {
    return S.rules.valuePlaceholders.schema;
  }
  if (rule.target === 'request_number') {
    return S.rules.valuePlaceholders.requestNumber;
  }

  return S.rules.valuePlaceholders.default;
};

export type RulesPatch = { rules?: ResponseRule[]; rulesOperator?: LogicalOperators };

type RulesEditorProps = {
  rules: ResponseRule[];
  rulesOperator: LogicalOperators;
  responseMode: ResponseMode | null;
  onChange: (patch: RulesPatch) => void;
};

/** Rules deciding when a response is served: every target and operator the engine supports. */
export function RulesEditor({ rules, rulesOperator, responseMode, onChange }: RulesEditorProps) {
  const update = (index: number, patch: Partial<ResponseRule>) =>
    onChange({
      rules: rules.map((rule, ruleIndex) => (ruleIndex === index ? { ...rule, ...patch } : rule)),
    });

  const ids = rules.map((_, index) => `rule-${index}`);
  const unusedMode = responseMode ? MODE_LABELS[responseMode] : undefined;

  return (
    <div className={styles.rules}>
      {unusedMode && (
        <div className="note" role="note">
          {S.rules.notUsed(unusedMode)}
        </div>
      )}
      {rules.length === 0 && <div className="muted">{S.rules.empty}</div>}

      <SortableList
        ids={ids}
        onMove={(from, to) => onChange({ rules: arrayMove(rules, from, to) })}
      >
        {({ index, handleProps }) => {
          const rule = rules[index];
          if (!rule) {
            return null;
          }
          const isRegex = rule.operator === 'regex' || rule.operator === 'regex_i';
          const invalidRegex = isRegex ? regexError(rule.value) : null;

          return (
            <Fragment>
              {index > 0 && (
                <div className={styles.operator}>
                  <button
                    type="button"
                    className="btn btn-small"
                    aria-label={`${S.rules.operatorLabel}: ${rulesOperator}`}
                    title={S.rules.operatorLabel}
                    onClick={() =>
                      onChange({ rulesOperator: rulesOperator === 'OR' ? 'AND' : 'OR' })
                    }
                  >
                    {rulesOperator}
                  </button>
                </div>
              )}
              <div className={styles.rule} data-testid="rule-row">
                <span
                  {...handleProps}
                  className={styles.handle}
                  aria-label={S.common.dragToReorder}
                  title={S.common.dragToReorder}
                >
                  <Icon name="drag" size={14} />
                </span>
                <select
                  className={`select ${styles.target}`}
                  aria-label={S.rules.target}
                  value={rule.target}
                  onChange={(event) =>
                    update(index, { target: event.target.value as ResponseRuleTargets })
                  }
                >
                  {TARGETS.map((target) => (
                    <option key={target} value={target}>
                      {S.rules.targets[target]}
                    </option>
                  ))}
                </select>
                {!NO_MODIFIER.has(rule.target) && (
                  <input
                    className={`input ${styles.modifier}`}
                    aria-label={S.rules.modifier}
                    placeholder={modifierPlaceholder(rule.target)}
                    value={rule.modifier}
                    spellCheck={false}
                    onChange={(event) => update(index, { modifier: event.target.value })}
                  />
                )}
                <button
                  type="button"
                  className={`btn btn-icon${rule.invert ? ' btn-primary' : ''}`}
                  aria-label={S.rules.invert}
                  aria-pressed={rule.invert}
                  title={S.rules.invert}
                  onClick={() => update(index, { invert: !rule.invert })}
                >
                  !
                </button>
                <select
                  className={`select ${styles.operatorSelect}`}
                  aria-label={S.rules.operator}
                  value={rule.operator}
                  onChange={(event) =>
                    update(index, { operator: event.target.value as ResponseRuleOperators })
                  }
                >
                  {OPERATORS.map((operator) => (
                    <option key={operator} value={operator}>
                      {S.rules.operators[operator]}
                    </option>
                  ))}
                </select>
                {!NO_VALUE.has(rule.operator) && (
                  <input
                    className={`input ${styles.value}`}
                    aria-label={S.rules.value}
                    aria-invalid={invalidRegex !== null}
                    placeholder={valuePlaceholder(rule)}
                    value={rule.value}
                    spellCheck={false}
                    onChange={(event) => update(index, { value: event.target.value })}
                  />
                )}
                <Button
                  variant="ghost"
                  icon="trash"
                  iconOnly
                  label={S.rules.remove}
                  onClick={() =>
                    onChange({ rules: rules.filter((_, ruleIndex) => ruleIndex !== index) })
                  }
                />
              </div>
              {invalidRegex && (
                <div className={`field-error ${styles.error}`} role="alert">
                  {S.validation.invalidRegex}: {invalidRegex}
                </div>
              )}
            </Fragment>
          );
        }}
      </SortableList>

      <div>
        <Button
          icon="plus"
          size="small"
          onClick={() => onChange({ rules: [...rules, BuildResponseRule()] })}
        >
          {S.rules.add}
        </Button>
      </div>
      <p className="field-help">{S.rules.help}</p>
    </div>
  );
}
