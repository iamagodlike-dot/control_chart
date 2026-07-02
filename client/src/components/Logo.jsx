export default function Logo({ size = 32, variant = 'plate' }) {
  if (variant === 'mark') {
    return <img src="/logo-mark-white.png" alt="" width={size} height={size} style={{ objectFit: 'contain' }} />;
  }
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: size, height: size, borderRadius: size * 0.25, flexShrink: 0,
        background: 'linear-gradient(150deg, var(--color-primary), color-mix(in srgb, var(--color-primary) 55%, #0a5))',
        boxShadow: '0 4px 16px -4px var(--brand-soft), inset 0 1px 0 rgba(255,255,255,.25)',
      }}
    >
      <img
        src="/logo-mark-white.png"
        alt=""
        width={size * 0.58}
        height={size * 0.58}
        style={{ objectFit: 'contain', filter: 'brightness(0)' }}
      />
    </span>
  );
}
