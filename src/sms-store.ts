export interface SmsMessage {
  id: string;
  sender: string;
  body: string;
  timestamp: number;
  receivedAt: number;
}

const MAX_MESSAGES = 50;
const messages: SmsMessage[] = [];
const listeners = new Set<() => void>();

export function addSmsMessage(m: SmsMessage): void {
  messages.push(m);
  if (messages.length > MAX_MESSAGES) {
    messages.shift();
  }
  for (const cb of listeners) cb();
}

export function getSmsMessages(): SmsMessage[] {
  return [...messages];
}

export function onSmsChanged(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
