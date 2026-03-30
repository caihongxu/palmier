import { loadSessions, revokeSession, revokeAllSessions } from "../session-store.js";

export async function sessionsListCommand(): Promise<void> {
  const sessions = loadSessions();
  if (sessions.length === 0) {
    console.log("No active sessions.");
    return;
  }

  console.log(`${sessions.length} active session(s):\n`);
  for (const s of sessions) {
    const label = s.label ? ` (${s.label})` : "";
    console.log(`  ${s.token}${label}  created ${s.createdAt}`);
  }
}

export async function sessionsRevokeCommand(token: string): Promise<void> {
  if (revokeSession(token)) {
    console.log("Session revoked.");
  } else {
    console.error("Session not found.");
    process.exit(1);
  }
}

export async function sessionsRevokeAllCommand(): Promise<void> {
  const count = revokeAllSessions();
  console.log(`Revoked ${count} session(s).`);
}
