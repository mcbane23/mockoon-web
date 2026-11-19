const PATHS = {
  play: 'M7 4.5v15l12-7.5z',
  stop: 'M6 6h12v12H6z',
  restart: 'M4 12a8 8 0 1 0 2.6-5.9M4 4v4.5h4.5',
  plus: 'M12 5v14M5 12h14',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  dots: 'M5 12h.01M12 12h.01M19 12h.01',
  folder: 'M3 6h6l2 2h10v11H3z',
  chevronRight: 'M9 6l6 6-6 6',
  chevronDown: 'M6 9l6 6 6-6',
  lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.500 0 0 1 7 0v3',
  warning: 'M12 3l10 18H2zM12 10v5M12 18h.01',
  flag: 'M5 21V4M5 4h12l-2 4 2 4H5',
  drag: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
  close: 'M6 6l12 12M18 6L6 18',
  settings: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M14 4v4M8 10v4M16 16v4',
  external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
  file: 'M6 3h8l4 4v14H6zM14 3v4h4',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  check: 'M5 12l5 5 9-10',
  back: 'M15 6l-6 6 6 6',
} as const;

export type IconName = keyof typeof PATHS;

const FILLED: ReadonlySet<IconName> = new Set(['play', 'stop']);

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  const filled = FILLED.has(name);

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={name === 'dots' || name === 'drag' ? 3 : 2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
