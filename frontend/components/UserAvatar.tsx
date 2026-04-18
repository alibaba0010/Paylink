'use client';

import { IconAvatar } from '@/components/IconPicker';

interface UserAvatarProps {
  /** Lucide icon key stored on the user profile (e.g. "zap", "rocket") */
  iconKey?: string;
  /** Fallback: first letter of name if no iconKey is provided */
  name?: string;
  className?: string;
}

/**
 * Renders the user's chosen profile icon if available,
 * otherwise falls back to an initial-letter avatar.
 */
export function UserAvatar({ iconKey, name = '', className = '' }: UserAvatarProps) {
  if (iconKey) {
    return <IconAvatar iconKey={iconKey} size={20} className={`h-10 w-10 ${className}`} />;
  }

  const initial = name ? name[0].toUpperCase() : '?';
  return (
    <div
      className={`flex items-center justify-center rounded-full bg-[#00C896]/20
                  font-bold text-[#00C896] border border-[#00C896] ${className}`}
    >
      {initial}
    </div>
  );
}
