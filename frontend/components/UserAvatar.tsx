interface UserAvatarProps {
  name: string;
  className?: string;
}

export function UserAvatar({ name, className = '' }: UserAvatarProps) {
  const initial = name ? name[0].toUpperCase() : '?';
  
  return (
    <div className={`flex items-center justify-center rounded-full bg-[#00C896]/20 font-bold text-[#00C896] border border-[#00C896] ${className}`}>
      {initial}
    </div>
  );
}
