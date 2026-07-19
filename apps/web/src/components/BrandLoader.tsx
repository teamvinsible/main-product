import { BrandLogo } from "./BrandLogo";

type BrandLoaderProps = {
  label?: string;
  className?: string;
};

/** Animated logo mark used as the app-wide loading indicator. */
export function BrandLoader({ label = "Loading…", className = "" }: BrandLoaderProps) {
  return (
    <div className={`brand-loader ${className}`.trim()} role="status" aria-live="polite">
      <BrandLogo compact className="brand-loader-mark" />
      {label && <p className="muted brand-loader-label">{label}</p>}
    </div>
  );
}
