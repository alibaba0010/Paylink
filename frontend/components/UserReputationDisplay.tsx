'use client';

import { useEffect, useState } from 'react';
import { getOnboardedUser } from '@/lib/onboarding-storage';
import { ReputationBadge } from './ReputationBadge';
import { type ReputationScore } from '@/lib/api';

interface Props {
  reputation: ReputationScore;
  profileUsername: string;
}

export function UserReputationDisplay({ reputation, profileUsername }: Props) {
  const [isOwner, setIsOwner] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const user = getOnboardedUser();
    if (user?.username === profileUsername) {
      setIsOwner(true);
    }
  }, [profileUsername]);

  if (!mounted || !isOwner) return null;

  return (
    <div className="w-full text-left">
      <ReputationBadge reputation={reputation} />
    </div>
  );
}
