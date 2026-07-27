import type { ReactNode, SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 18, ...props }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    ...props,
  };
}

export function IconSearch(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

export function IconBox(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M21 8 12 3 3 8l9 5 9-5Z" />
      <path d="M3 8v8l9 5 9-5V8" />
      <path d="M12 13v8" />
    </svg>
  );
}

export function IconPalette(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M12 22a10 10 0 1 1 0-20 10 10 0 0 1 0 20Z" />
      <circle cx="12" cy="7.5" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="8" cy="10.5" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="16" cy="10.5" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="9.5" cy="15" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconChat(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M21 12a8 8 0 0 1-8 8H7l-4 3V12a8 8 0 1 1 18 0Z" />
    </svg>
  );
}

export function IconMail(p: IconProps) {
  return (
    <svg {...base(p)}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 7 9-7" />
    </svg>
  );
}

export function IconCode(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="m8 8-4 4 4 4" />
      <path d="m16 8 4 4-4 4" />
      <path d="m14 5-4 14" />
    </svg>
  );
}

export function IconCheck(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12.5 2.5 2.5 4.5-5" />
    </svg>
  );
}

export function IconStar(p: IconProps) {
  return (
    <svg {...base({ ...p, strokeWidth: 1.5 })}>
      <path
        d="m12 3 2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 15.9 7.2 18l.9-5.4L4.2 8.7l5.4-.8L12 3Z"
        fill="currentColor"
        stroke="none"
      />
    </svg>
  );
}

export function IconDoc(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 17h6" />
    </svg>
  );
}

export function IconExternal(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M14 4h6v6" />
      <path d="M10 14 20 4" />
      <path d="M20 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5" />
    </svg>
  );
}

export function IconScales(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M12 3v18" />
      <path d="M5 7h14" />
      <path d="M7 7 4 13a3 3 0 0 0 6 0L7 7Z" />
      <path d="M17 7l-3 6a3 3 0 0 0 6 0l-3-6Z" />
    </svg>
  );
}

export function IconEye(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function IconQuestion(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1.9-1.1 1.8" />
      <circle cx="12" cy="17" r="0.8" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconClose(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

export function IconBrief(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <rect x="4" y="7" width="16" height="13" rx="2" />
    </svg>
  );
}

export function IconChevron(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function IconPlus(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function IconWand(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="m15 4 5 5L7 22l-5-5Z" />
      <path d="m17.5 2.5 1 1" />
      <path d="m20.5 5.5 1 1" />
      <path d="m14.5 2.5 1 1" />
      <path d="m17.5 5.5 1 1" />
      <path d="m20.5 2.5 1 1" />
    </svg>
  );
}

export function IconLoop(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M17 2v4h4" />
      <path d="M21 6A9 9 0 1 0 19.5 17" />
      <path d="M7 22v-4H3" />
      <path d="M3 18a9 9 0 0 0 1.5-11" />
    </svg>
  );
}

export function IconSun(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

export function IconMoon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M21 14.5A8.5 8.5 0 1 1 9.5 3 7 7 0 0 0 21 14.5Z" />
    </svg>
  );
}

export function IconMonitor(p: IconProps) {
  return (
    <svg {...base(p)}>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </svg>
  );
}

export function IconPulse(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M3 12h3l2.5-6 3 12L14 9l2 3h5" />
    </svg>
  );
}

export function IconUsers(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19c.6-3 2.7-4.5 5.5-4.5S14 16 14.5 19" />
      <circle cx="17.5" cy="9" r="2.4" />
      <path d="M15 19c.4-2 1.7-3.2 3.8-3.2 1.4 0 2.5.5 3.2 1.5" />
    </svg>
  );
}

export function IconAlert(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M12 3.5 21 19H3L12 3.5Z" />
      <path d="M12 9v5" />
      <circle cx="12" cy="16.5" r="0.8" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconFlower({ size = 28, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" {...props}>
      <circle cx="16" cy="10" r="5.2" fill="var(--blue)" />
      <circle cx="22" cy="16" r="5.2" fill="var(--blue-2)" opacity="0.9" />
      <circle cx="16" cy="22" r="5.2" fill="var(--blue)" />
      <circle cx="10" cy="16" r="5.2" fill="var(--blue-2)" opacity="0.9" />
      <circle cx="16" cy="16" r="3.2" fill="var(--surface)" />
      <circle cx="16" cy="16" r="1.5" fill="var(--blue)" />
    </svg>
  );
}

export const WORKSTREAM_ICONS: Record<string, (p: IconProps) => ReactNode> = {
  brief: (p) => <IconBrief {...p} />,
  scoping: (p) => <IconBrief {...p} />,
  research: (p) => <IconSearch {...p} />,
  product: (p) => <IconBox {...p} />,
  branding: (p) => <IconPalette {...p} />,
  brand: (p) => <IconPalette {...p} />,
  design: (p) => <IconPalette {...p} />,
  social: (p) => <IconChat {...p} />,
  marketing: (p) => <IconChat {...p} />,
  email: (p) => <IconMail {...p} />,
  engineering: (p) => <IconCode {...p} />,
  architecture: (p) => <IconCode {...p} />,
  development: (p) => <IconCode {...p} />,
  deployment: (p) => <IconCode {...p} />,
  review: (p) => <IconCheck {...p} />,
  qa: (p) => <IconCheck {...p} />,
  seo: (p) => <IconSearch {...p} />,
  analytics: (p) => <IconBox {...p} />,
};

export const SPEC_ICONS: Record<string, (p: IconProps) => ReactNode> = {
  "product-brief": (p) => <IconBox {...p} />,
  "brand-direction": (p) => <IconPalette {...p} />,
  "social-plan": (p) => <IconChat {...p} />,
  "email-sequence": (p) => <IconMail {...p} />,
  "eng-arch": (p) => <IconCode {...p} />,
  "research-notes": (p) => <IconSearch {...p} />,
};
