import { loadClients, revokeClient, revokeAllClients } from "../client-store.js";

export async function clientsListCommand(): Promise<void> {
  const clients = loadClients();
  if (clients.length === 0) {
    console.log("No active clients.");
    return;
  }

  console.log(`${clients.length} active client(s):\n`);
  for (const c of clients) {
    const label = c.label ? ` (${c.label})` : "";
    console.log(`  ${c.token}${label}  created ${c.createdAt}`);
  }
}

export async function clientsRevokeCommand(token: string): Promise<void> {
  if (revokeClient(token)) {
    console.log("Client revoked.");
  } else {
    console.error("Client not found.");
    process.exit(1);
  }
}

export async function clientsRevokeAllCommand(): Promise<void> {
  const count = revokeAllClients();
  console.log(`Revoked ${count} client(s).`);
}
