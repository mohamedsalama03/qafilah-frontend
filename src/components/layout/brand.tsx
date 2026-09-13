export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5 text-text" aria-label="Qafilah">
      <svg width="29" height="29" viewBox="0 0 32 32" fill="none" aria-hidden="true">
        <rect width="32" height="32" rx="8" className="fill-brand" />
        <path
          d="M21.5 21.5H12a3.5 3.5 0 0 1-3.5-3.5v-6A3.5 3.5 0 0 1 12 8.5h6a3.5 3.5 0 0 1 3.5 3.5v9.5Zm-6-6 9 9"
          stroke="white"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {!compact && (
        <span className="text-xl font-semibold tracking-tight">
          qafilah<span className="text-brand">.</span>
        </span>
      )}
    </span>
  );
}
