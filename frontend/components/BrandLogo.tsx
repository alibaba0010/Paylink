import Link from 'next/link';

interface BrandLogoProps {
  href?: string;
  className?: string;
  imageClassName?: string;
}

export function BrandLogo({
  href = '/',
  className = '',
  imageClassName = '',
}: BrandLogoProps) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-2.5 group transition-opacity hover:opacity-90 ${className}`.trim()}
      aria-label="PayLink home"
    >
      <div className="relative flex items-center justify-center">
        <img
          src="/paylink.svg"
          alt="PayLink Logo"
          className={`h-9 w-auto ${imageClassName}`.trim()}
        />
      </div>
      <span className="text-xl font-bold tracking-tight text-white">
        Pay<span className="text-[#00C896]">Link</span>
      </span>
    </Link>
  );
}
