const PATHS = {
  bulletList: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01',
  orderedList: 'M10 6h10M10 12h10M10 18h10M4 5l1-1v5M4 18.5c0-1 2-1.5 2-2.5s-.8-1-1.5-1-1 .5-1 .5M4 20h2',
  quote: 'M5 7h4v4c0 3-1.5 5-4 6M14 7h4v4c0 3-1.5 5-4 6',
  undo: 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  redo: 'm15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13',
};

export function Icon({ name }: { name: keyof typeof PATHS }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}
