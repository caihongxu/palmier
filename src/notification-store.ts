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

export function addNotification(n: DeviceNotification): void {
  notifications.push(n);
  if (notifications.length > MAX_NOTIFICATIONS) {
    notifications.shift();
  }
}

export function getNotifications(): DeviceNotification[] {
  return [...notifications];
}
