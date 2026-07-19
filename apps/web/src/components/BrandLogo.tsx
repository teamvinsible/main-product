type BrandLogoProps = {
  compact?: boolean;
  className?: string;
};

export function BrandLogo({ compact = false, className = "" }: BrandLogoProps) {
  return (
    <span className={`brand-logo ${compact ? "is-compact" : ""} ${className}`.trim()} aria-hidden="true">
      <svg className="brand-logo-mark" viewBox="0 0 36 36" role="img">
        <path className="brand-logo-rail" d="M8 9.5h20M18 9.5v17" />
        <path className="brand-logo-signal" d="m10.5 19 7.5 8 7.5-8" />
        <circle cx="8" cy="9.5" r="2.25" />
        <circle cx="28" cy="9.5" r="2.25" />
        <circle cx="18" cy="27" r="2.25" />
      </svg>
      {!compact && (
        <span className="brand-logo-word">
          <span>team</span><span className="brand-logo-accent">v</span>insible
        </span>
      )}
    </span>
  );
}
