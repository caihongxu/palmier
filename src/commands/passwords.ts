import { listPasswords, deletePassword, clearPasswords, normalizeOrigin } from "../password-store.js";

export async function passwordsListCommand(): Promise<void> {
  const entries = listPasswords();
  if (entries.length === 0) {
    console.log("No saved passwords.");
    return;
  }

  console.log(`${entries.length} saved password(s):\n`);
  for (const e of entries) {
    console.log(`  ${e.origin}  ${e.username}`);
  }
}

export async function passwordsDeleteCommand(origin: string, username?: string): Promise<void> {
  if (deletePassword(normalizeOrigin(origin), username)) {
    console.log("Password deleted.");
  } else {
    console.error("No matching saved password.");
    process.exit(1);
  }
}

export async function passwordsClearCommand(): Promise<void> {
  const count = clearPasswords();
  console.log(`Cleared ${count} saved password(s).`);
}
