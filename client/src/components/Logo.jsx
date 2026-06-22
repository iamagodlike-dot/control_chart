export default function Logo({ size = 32, variant = 'plate' }) {
  if (variant === 'mark') {
    return <img src="/logo-mark-white.png" alt="" width={size} height={size} style={{ objectFit: 'contain' }} />;
  }
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: size, height: size, borderRadius: size * 0.22, background: '#C2802B', flexShrink: 0,
      }}
    >
      <img src="/logo-mark-white.png" alt="" width={size * 0.62} height={size * 0.62} style={{ objectFit: 'contain' }} />
    </span>
  );
}
