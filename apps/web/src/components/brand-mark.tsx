import type { SVGProps } from 'react';

/**
 * OCI brand mark — abstract pulse-on-shield motif.
 *
 *   - The shield silhouette nods to public health (WHO/UN context).
 *   - The horizontal pulse line nods to AI/data signal — clinical
 *     vitals + model output read as the same visual language here.
 *   - All paths use the design-system primary color so the mark
 *     works on any surface that token covers.
 */
export function BrandMark({ size = 28, ...props }: SVGProps<SVGSVGElement> & { size?: number }) {
  return (
    <svg
      role="img"
      aria-label="OCI Platform"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M16 3 L27 7 V16 C27 22.5 22 27.5 16 29 C10 27.5 5 22.5 5 16 V7 Z" fill="none" />
      <path d="M9 17 L13 17 L15 13 L18 21 L20 17 L23 17" />
    </svg>
  );
}

/**
 * Wordmark + brand mark, suitable for a header.
 */
export function BrandLockup({ className }: { className?: string }) {
  return (
    <span
      className={className}
      style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}
    >
      <BrandMark size={26} className="text-[var(--color-primary)]" />
      <span className="font-semibold tracking-tight text-[var(--color-foreground)]">
        OCI Platform
      </span>
    </span>
  );
}
