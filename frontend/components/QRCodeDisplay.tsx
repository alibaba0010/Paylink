'use client';

import { QRCodeSVG } from 'qrcode.react';

interface QRCodeDisplayProps {
  url: string;
  size?: number;
}

export function QRCodeDisplay({ url, size = 128 }: QRCodeDisplayProps) {
  return (
    <div className="p-2 bg-white rounded-lg inline-block">
      <QRCodeSVG value={url} size={size} />
    </div>
  );
}
