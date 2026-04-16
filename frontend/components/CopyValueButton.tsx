'use client';

import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';

interface CopyValueButtonProps {
  value: string;
  className?: string;
  title?: string;
}

export function CopyValueButton({
  value,
  className = '',
  title = 'Copy value',
}: CopyValueButtonProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setCopied(false);
    }, 1800);

    return () => window.clearTimeout(timeoutId);
  }, [copied]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch (error) {
      console.error('Failed to copy value:', error);
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        void handleCopy();
      }}
      title={copied ? 'Copied' : title}
      aria-label={copied ? 'Copied' : title}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/5 text-[#8EA0C5] transition hover:border-[#00C896]/40 hover:text-[#00C896] ${className}`}
    >
      {copied ? <Check size={15} /> : <Copy size={15} />}
    </button>
  );
}
