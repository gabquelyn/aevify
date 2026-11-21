/** The Aevify mark: the same "A" geometry used by the hero artwork. */
export function LogoMark({ className = "size-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} aria-hidden="true">
      <path
        fillRule="evenodd"
        fill="currentColor"
        d="M0 20 7.6 0h4.8L20 20h-4.8l-2-5.6H6.8l-2 5.6Zm10-15.2-2.2 6.4h4.4Z"
      />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="inline-flex items-center gap-2 text-[15px] font-semibold tracking-tight text-ink">
      <LogoMark className="size-[18px] text-brand-500" />
      Aevify
    </span>
  );
}
