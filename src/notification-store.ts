export interface DeviceNotification {
  id: string;
  packageName: string;
  appName: string;
  title: string;
  text: string;
  timestamp: number;
  receivedAt: number;
}

const MAX_NOTIFICATIONS = 50;
const notifications: DeviceNotification[] = [];
const listeners = new Set<() => void>();

export function addNotification(n: DeviceNotification): void {
  notifications.push(n);
  if (notifications.length > MAX_NOTIFICATIONS) {
    notifications.shift();
  }
  for (const cb of listeners) cb();
}

export function getNotifications(): DeviceNotification[] {
  return [...notifications];
}

export function onNotificationsChanged(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
