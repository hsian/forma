export function BrandMark({ small = false }: { small?: boolean }) {
  return <span className={`brand-mark${small ? ' small' : ''}`} aria-hidden="true">
    <svg width="100%" height="100%" viewBox="0 0 32 32" fill="none">
      <rect x="12" y="6" width="14" height="17" rx="3" fill="white" opacity=".24"/>
      <path d="M8 10.5A2.5 2.5 0 0 1 10.5 8H22v4H12v4h8v4h-8v6H8V10.5Z" fill="white"/>
      <path d="M23 25h3m-1.5-1.5v3" stroke="white" strokeWidth="1.5" strokeLinecap="round" opacity=".8"/>
    </svg>
  </span>;
}
