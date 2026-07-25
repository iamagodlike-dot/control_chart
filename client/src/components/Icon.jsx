// Inline line-icon set for the redesigned dispatcher (control-room look).
// Paths taken 1:1 from the design handoff (Lucide/Feather-style, stroke 1.6–1.8).
// No external dependency — <Icon name="calendar" size={16} /> renders currentColor.

const PATHS = {
  // nav
  calendar: <path d="M8 2v3M16 2v3M3.5 9h17M4 5h16a1 1 0 0 1 1 1v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a1 1 0 0 1 1-1Z" />,
  chart: <path d="M3 3v18h18M8 15v3M13 10v8M18 6v12" />,
  box: <path d="m21 8-9-5-9 5v8l9 5 9-5V8ZM3 8l9 5 9-5M12 13v8" />,
  history: <path d="M3 12a9 9 0 1 0 3-6.7L3 8m0-5v5h5M12 7v5l3 2" />,
  wallet: <path d="M3 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3m0 0h-4a2 2 0 0 0 0 4h4m0-4v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7" />,
  gear: <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H1a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 2.6 7a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H7a1.6 1.6 0 0 0 1-1.5V1a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V7a1.6 1.6 0 0 0 1.5 1H23a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" />,
  // ui
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  shield: <path d="M12 2 4 5v6c0 5 3.4 8.5 8 11 4.6-2.5 8-6 8-11V5l-8-3Z" />,
  check: <path d="M20 6 9 17l-5-5" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  'chevron-left': <path d="m15 18-6-6 6-6" />,
  'chevron-right': <path d="m9 18 6-6-6-6" />,
  'chevron-down': <path d="m6 9 6 6 6-6" />,
  refresh: <path d="M3 12a9 9 0 1 0 3-6.7L3 8m0 0V3m0 5h5" />,
  power: <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4m7 14 5-5-5-5m5 5H9" />,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  moon: <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z" />,
  maximize: <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3m13-5v3a2 2 0 0 1-2 2h-3" />,
  warning: <path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />,
  file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6" /></>,
  camera: <><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z" /><circle cx="12" cy="13" r="3.5" /></>,
  image: <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /></>,
  download: <path d="M12 3v12m0 0-4-4m4 4 4-4M5 21h14" />,
  plus: <path d="M12 5v14M5 12h14" />,
  x: <path d="M18 6 6 18M6 6l12 12" />,
  trash: <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />,
  minus: <path d="M5 12h14" />,
  car: <><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9L18.4 7.5A2 2 0 0 0 16.5 6h-9a2 2 0 0 0-1.9 1.4L4.5 11.1C3.7 11.3 3 12.1 3 13v3c0 .6.4 1 1 1h2" /><circle cx="7" cy="17" r="2" /><circle cx="17" cy="17" r="2" /></>,
  receipt: <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1-2-1ZM8 7h8M8 11h8M8 15h5" />,
  clipboard: <><rect x="8" y="3" width="8" height="4" rx="1" /><path d="M16 5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2M9 13h6M9 17h4" /></>,
  cart: <><circle cx="9" cy="20" r="1.4" /><circle cx="18" cy="20" r="1.4" /><path d="M2 3h2.2l2.3 12a2 2 0 0 0 2 1.6h8.2a2 2 0 0 0 2-1.6L21 7H5.2" /></>,
  tv: <><rect x="2" y="7" width="20" height="13" rx="2" /><path d="m8 3 4 4 4-4" /></>,
  wrench: <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76Z" />,
  pin: <><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" /></>,
  key: <><circle cx="7.5" cy="15.5" r="5.5" /><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3" /></>,
  building: <><path d="M4 21V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v15" /><path d="M15 9h3a2 2 0 0 1 2 2v10" /><path d="M3 21h18M8 8h3M8 12h3M8 16h3" /></>,
  columns: <><rect x="3" y="4" width="18" height="16" rx="1.5" /><path d="M9 4v16M15 4v16" /></>,
  edit: <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" />,
  // Бумажный самолётик — раздел «Телеграм-бот» и кнопки отправки.
  send: <path d="M21.5 2.5 2 10.2l7.6 2.9 3 7.7 8.9-18.3ZM9.6 13.1l4.6-4.6" />,
  bell: <path d="M18 8a6 6 0 1 0-12 0c0 6-2 7-2 7h16s-2-1-2-7M13.7 21a2 2 0 0 1-3.4 0" />,
};

export default function Icon({ name, size = 16, strokeWidth = 1.7, className, style }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      className={className} style={style} aria-hidden="true"
    >
      {PATHS[name] || null}
    </svg>
  );
}
