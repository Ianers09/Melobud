// Melobud mark: a guitar pick with a "bud" sound hole.
export function LogoMark({ size = 22, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        d="M12 1.6c5.9 0 10.4 2.3 10.4 6.4 0 5.4-5.4 11.8-9.3 14a2.3 2.3 0 0 1-2.2 0C7 19.8 1.6 13.4 1.6 8 1.6 3.9 6.1 1.6 12 1.6Z"
        fill="var(--color-brass)"
      />
      <circle cx="12" cy="8.6" r="2.6" fill="var(--color-bg)" />
    </svg>
  )
}

export function Logo({ size = 'md', className = '' }) {
  const mark = size === 'lg' ? 28 : 22
  const text = size === 'lg' ? 'text-[24px]' : 'text-[19px]'
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <LogoMark size={mark} />
      <span className={`font-display font-extrabold tracking-[-0.04em] text-ink ${text}`}>melobud</span>
    </span>
  )
}
