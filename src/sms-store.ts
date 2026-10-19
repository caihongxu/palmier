export interface SmsMessage {
  id: string;
  sender: string;
  body: string;
  timestamp: number;
  receivedAt: number;
}

const MAX_MESSAGES = 50;
const messages: SmsMessage[] = [];

export function addSmsMessage(m: SmsMessage): void {
  messages.push(m);
  if (messages.length > MAX_MESSAGES) {
    messages.shift();
  }
}

export function getSmsMessages(): SmsMessage[] {
  return [...messages];
}
