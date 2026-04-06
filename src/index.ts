#!/usr/bin/env node

import "dotenv/config";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { infoCommand } from "./commands/info.js";
import { runCommand } from "./commands/run.js";
import { serveCommand } from "./commands/serve.js";

import { pairCommand } from "./commands/pair.js";
import { restartCommand } from "./commands/restart.js";
import { sessionsListCommand, sessionsRevokeCommand, sessionsRevokeAllCommand } from "./commands/sessions.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf-8"));

const program = new Command();

program
  .name("palmier")
  .description("Palmier host CLI")
  .version(pkg.version);

program
  .command("init")
  .description("Provision this host")
  .action(async () => {
    await initCommand();
  });

program
  .command("info")
  .description("Show host connection info")
  .action(async () => {
    await infoCommand();
  });

program
  .command("run <task-id>")
  .description("Execute a task by ID")
  .action(async (taskId: string) => {
    await runCommand(taskId);
  });

program
  .command("serve")
  .description("Start the persistent RPC handler")
  .action(async () => {
    await serveCommand();
  });

program
  .command("restart")
  .description("Restart the palmier serve daemon")
  .action(async () => {
    await restartCommand();
  });


program
  .command("pair")
  .description("Generate a pairing code for connecting a PWA client")
  .action(async () => {
    await pairCommand();
  });


const sessionsCmd = program
  .command("sessions")
  .description("Manage paired client sessions");

sessionsCmd
  .command("list")
  .description("List active sessions")
  .action(async () => {
    await sessionsListCommand();
  });

sessionsCmd
  .command("revoke <token>")
  .description("Revoke a session by token")
  .action(async (token: string) => {
    await sessionsRevokeCommand(token);
  });

sessionsCmd
  .command("revoke-all")
  .description("Revoke all sessions")
  .action(async () => {
    await sessionsRevokeAllCommand();
  });

// No subcommand → default to serve
if (process.argv.length <= 2) {
  process.argv.push("serve");
}

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
