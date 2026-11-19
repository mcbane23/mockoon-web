import { S } from '../../strings';

/** Static templating cheat sheet shown next to the body editor. */
export function TemplatingHelp() {
  return (
    <aside aria-label={S.templating.title} style={{ fontSize: 12 }}>
      <table className="kv-table">
        <tbody>
          {S.templating.rows.map(([example, meaning]) => (
            <tr key={example}>
              <td style={{ width: '58%' }}>
                <code>{example}</code>
              </td>
              <td className="muted">{meaning}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ marginTop: 8 }}>
        <a href={S.templating.url} target="_blank" rel="noreferrer noopener">
          {S.templating.allHelpers}
        </a>
      </p>
    </aside>
  );
}
