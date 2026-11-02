// Small original icons for the Ship It Docker games (no vendor logos). All decorative:
// every icon sits next to words that say the same thing.
type P = { size?: number };
const svg = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
});

/** A lunchbox: a container. */
export function LunchboxIcon({ size = 18 }: P) {
  return (
    <svg {...svg(size)}>
      <rect x="3" y="8" width="18" height="12" rx="2" />
      <path d="M3 12h18M9 8V5h6v3" />
    </svg>
  );
}

/** A locker: a named volume. */
export function LockerIcon({ size = 18 }: P) {
  return (
    <svg {...svg(size)}>
      <rect x="5" y="3" width="14" height="18" rx="1.5" />
      <path d="M9 7h6M9 10h6M15 14v2" />
    </svg>
  );
}

/** A shelf with a folder: a bind mount (a folder on your laptop). */
export function ShelfIcon({ size = 18 }: P) {
  return (
    <svg {...svg(size)}>
      <path d="M3 20h18M5 20V9h5l2 2h7v9" />
    </svg>
  );
}

/** A sticky note: tmpfs (memory only). */
export function NoteIcon({ size = 18 }: P) {
  return (
    <svg {...svg(size)}>
      <path d="M5 4h14v11l-5 5H5z" />
      <path d="M14 20v-5h5M8 9h8M8 12h5" />
    </svg>
  );
}

/** An oven: a layer baking again. */
export function OvenIcon({ size = 16 }: P) {
  return (
    <svg {...svg(size)}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18M7 6.5h.01M11 6.5h.01" />
      <rect x="7" y="12" width="10" height="5" rx="1" />
    </svg>
  );
}

/** A tick in a circle: kept / cached. */
export function KeptIcon({ size = 16 }: P) {
  return (
    <svg {...svg(size)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.5l2.5 2.5L16 9.5" />
    </svg>
  );
}

/** A laptop: your computer. */
export function LaptopIcon({ size = 18 }: P) {
  return (
    <svg {...svg(size)}>
      <rect x="4" y="5" width="16" height="11" rx="1.5" />
      <path d="M2 19h20" />
    </svg>
  );
}

/** A plug: a port. */
export function PlugIcon({ size = 16 }: P) {
  return (
    <svg {...svg(size)}>
      <path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4" />
    </svg>
  );
}

/** A shrink ray. */
export function RayIcon({ size = 18 }: P) {
  return (
    <svg {...svg(size)}>
      <path d="M3 12h7M13 8l7-4M13 16l7 4M13 12h8" />
      <circle cx="11" cy="12" r="2" />
    </svg>
  );
}

/** An eye with an x-ray: what a process can see. */
export function XrayIcon({ size = 18 }: P) {
  return (
    <svg {...svg(size)}>
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
