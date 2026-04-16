import type { UserProfile } from './api';

export const ONBOARDED_USER_STORAGE_KEY = 'paylink.onboarded-user';

export function saveOnboardedUser(user: UserProfile) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(
    ONBOARDED_USER_STORAGE_KEY,
    JSON.stringify(user)
  );
}

export function getOnboardedUser() {
  if (typeof window === 'undefined') {
    return null;
  }

  const rawUser = window.localStorage.getItem(ONBOARDED_USER_STORAGE_KEY);

  if (!rawUser) {
    return null;
  }

  try {
    return JSON.parse(rawUser) as UserProfile;
  } catch {
    window.localStorage.removeItem(ONBOARDED_USER_STORAGE_KEY);
    return null;
  }
}

export function clearOnboardedUser() {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.removeItem(ONBOARDED_USER_STORAGE_KEY);
}
