import {
  BodyTypes,
  GetRouteResponseContentType,
  type Environment,
  type RouteResponse,
} from '@mockoon/commons';
import { useId, useState } from 'react';
import { Button } from '../../components/Button';
import { CodeEditor } from '../../components/CodeEditor';
import { Toggle } from '../../components/Toggle';
import { ValidatedInput } from '../../components/ValidatedInput';
import { languageForContentType, prettifyJson } from '../../lib/content-type';
import { validateIntegerInRange } from '../../lib/validation';
import { toastError } from '../../store/app-store';
import { COMMON_STATUS_CODES, S } from '../../strings';
import styles from './RouteEditor.module.css';
import { TemplatingHelp } from './TemplatingHelp';

type Props = {
  environment: Environment;
  response: RouteResponse;
  onChange: (patch: Partial<RouteResponse>) => void;
};

const HELP_KEY = 'mockpit.templatingHelp';

const BODY_TYPES: [BodyTypes, string][] = [
  [BodyTypes.INLINE, S.body.inline],
  [BodyTypes.FILE, S.body.file],
  [BodyTypes.DATABUCKET, S.body.databucket],
];

export function StatusBodyTab({ environment, response, onChange }: Props) {
  const statusListId = useId();
  const groupName = useId();
  const [showHelp, setShowHelp] = useState(() => {
    try {
      return localStorage.getItem(HELP_KEY) === '1';
    } catch {
      return false;
    }
  });

  const contentType = GetRouteResponseContentType(environment, response);
  const language = languageForContentType(contentType);
  const bucketExists = environment.data.some((bucket) => bucket.id === response.databucketID);

  const toggleHelp = () => {
    setShowHelp((current) => {
      try {
        localStorage.setItem(HELP_KEY, current ? '0' : '1');
      } catch {
        // storage may be unavailable
      }

      return !current;
    });
  };

  const prettify = () => {
    const formatted = prettifyJson(response.body);
    if (formatted === null) {
      // typically a body with {{templating}} outside of strings
      toastError(S.body.cannotFormat);
    } else if (formatted !== response.body) {
      onChange({ body: formatted });
    }
  };

  return (
    <div className={styles.tabContent}>
      <div className={styles.statusRow}>
        <div style={{ flex: '0 0 130px' }}>
          <ValidatedInput
            label={S.body.statusCode}
            value={String(response.statusCode)}
            inputMode="numeric"
            list={statusListId}
            validate={(value) =>
              validateIntegerInRange(value, 100, 999) ? S.validation.statusRange : null
            }
            onCommit={(value) => onChange({ statusCode: Number(value) })}
          />
          <datalist id={statusListId}>
            {COMMON_STATUS_CODES.map(([code, name]) => (
              <option key={code} value={code}>
                {`${code} ${name}`}
              </option>
            ))}
          </datalist>
        </div>
        <label className="field grow">
          <span className="field-label">{S.body.label}</span>
          <input
            className="input"
            placeholder={S.body.labelPlaceholder}
            value={response.label}
            onChange={(event) => onChange({ label: event.target.value })}
          />
        </label>
      </div>

      <fieldset className={styles.bodyTypes}>
        <legend className="field-label">{S.body.bodyType}</legend>
        {BODY_TYPES.map(([type, label]) => (
          <label key={type} className="row">
            <input
              type="radio"
              name={groupName}
              checked={response.bodyType === type}
              // switching the type keeps body, filePath and databucketID as they were
              onChange={() => onChange({ bodyType: type })}
            />
            {label}
          </label>
        ))}
      </fieldset>

      {response.bodyType === BodyTypes.INLINE && (
        <div className={styles.bodyArea}>
          <div className="grow">
            <CodeEditor
              value={response.body ?? ''}
              language={language}
              ariaLabel={S.body.editorLabel}
              onChange={(body) => onChange({ body })}
            />
            <div className="row" style={{ marginTop: 6 }}>
              <span className="muted grow truncate">
                {contentType ? S.body.contentType(contentType) : S.body.noContentType}
              </span>
              {language === 'json' && (
                <Button size="small" onClick={prettify}>
                  {S.body.prettify}
                </Button>
              )}
              <Button size="small" variant="ghost" aria-expanded={showHelp} onClick={toggleHelp}>
                {showHelp ? S.templating.hide : S.templating.show}
              </Button>
            </div>
          </div>
          {showHelp && (
            <div className={styles.help}>
              <TemplatingHelp />
            </div>
          )}
        </div>
      )}

      {response.bodyType === BodyTypes.FILE && (
        <>
          <label className="field">
            <span className="field-label">{S.body.filePath}</span>
            <input
              className="input mono"
              placeholder={S.body.filePathPlaceholder}
              spellCheck={false}
              value={response.filePath}
              onChange={(event) => onChange({ filePath: event.target.value })}
            />
            <span className="field-help">{S.body.filePathHelp}</span>
          </label>
          <Toggle
            checked={response.sendFileAsBody}
            label={S.body.sendFileAsBody}
            onChange={(sendFileAsBody) => onChange({ sendFileAsBody })}
          />
          <Toggle
            checked={response.fallbackTo404}
            label={S.body.fallbackTo404}
            onChange={(fallbackTo404) => onChange({ fallbackTo404 })}
          />
        </>
      )}

      {response.bodyType === BodyTypes.DATABUCKET &&
        (environment.data.length === 0 ? (
          <div className="note">{S.body.noBuckets}</div>
        ) : (
          <label className="field" style={{ maxWidth: 360 }}>
            <span className="field-label">{S.body.databucket}</span>
            <select
              className="select"
              value={bucketExists ? response.databucketID : ''}
              onChange={(event) => onChange({ databucketID: event.target.value })}
            >
              <option value="" disabled>
                {S.body.selectBucket}
              </option>
              {environment.data.map((bucket) => (
                <option key={bucket.uuid} value={bucket.id}>
                  {bucket.name}
                </option>
              ))}
            </select>
            {response.databucketID && !bucketExists && (
              <span className="field-error">{S.body.missingBucket}</span>
            )}
          </label>
        ))}
    </div>
  );
}
