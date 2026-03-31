const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no O/0/I/1/L
const CODE_LENGTH = 6;

export const PAIRING_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

export function generatePairingCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => CODE_CHARS[b % CODE_CHARS.length]).join("");
}
