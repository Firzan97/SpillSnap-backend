import { defaultNotificationPrefs } from '../settings/settings.defaults';
import { User } from '../users/entities/user.entity';

const DEFAULTS = defaultNotificationPrefs();

/**
 * Effective value of a notification toggle for a user: their stored override if
 * present, else the system default for that key (opt-in/opt-out as configured).
 */
export function prefEnabled(user: User, key: string): boolean {
  const stored = user.notificationPrefs?.prefs?.[key];
  if (typeof stored === 'boolean') return stored;
  return DEFAULTS.prefs[key] ?? false;
}

/** Whether the user accepts push delivery at all (channel master switch). */
export function pushChannelOn(user: User): boolean {
  return user.notificationPrefs?.channels?.push ?? DEFAULTS.channels.push;
}
