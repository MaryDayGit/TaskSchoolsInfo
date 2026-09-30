import { useMemo } from 'react';
import qrcode from 'qrcode-generator';

/** A QR code as one SVG path (black squares on white), readable by phone cameras. */
export function QrCode({
  text,
  size = 200,
  label,
}: {
  text: string;
  size?: number;
  label: string;
}) {
  const { d, n } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const count = qr.getModuleCount();
    let path = '';
    for (let r = 0; r < count; r++) {
      for (let c = 0; c < count; c++) {
        if (qr.isDark(r, c)) path += `M${c + 2} ${r + 2}h1v1h-1z`;
      }
    }
    return { d: path, n: count + 4 };
  }, [text]);
  return (
    <svg
      className="qr"
      width={size}
      height={size}
      viewBox={`0 0 ${n} ${n}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <rect width={n} height={n} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}
