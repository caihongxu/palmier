import * as readline from "readline";

export interface SelectChoice {
  label: string;
  hint?: string;
}

export async function selectFromList(
  message: string,
  choices: SelectChoice[],
  footer = "(↑/↓ to navigate, Enter to select)",
): Promise<number | null> {
  if (!process.stdin.isTTY) {
    process.stdout.write(message + "\n");
    choices.forEach((c, i) => {
      const hint = c.hint ? `  ${c.hint}` : "";
      process.stdout.write(`  ${i + 1}) ${c.label}${hint}\n`);
    });
    return null;
  }

  const stdout = process.stdout;
  return new Promise((resolve) => {
    let active = 0;
    const messageLines = (message.match(/\n/g)?.length ?? 0) + 1;
    const totalLines = messageLines + choices.length + (footer ? 1 : 0);
    let firstRender = true;

    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    stdout.write("\x1b[?25l");

    const render = () => {
      if (!firstRender) {
        readline.moveCursor(stdout, 0, -totalLines);
        readline.clearScreenDown(stdout);
      }
      firstRender = false;
      stdout.write(message + "\n");
      choices.forEach((c, i) => {
        const isActive = i === active;
        const marker = isActive ? "\x1b[36m❯\x1b[0m" : " ";
        const label = isActive ? `\x1b[36m${c.label}\x1b[0m` : c.label;
        const hint = c.hint ? `  \x1b[2m${c.hint}\x1b[0m` : "";
        stdout.write(`${marker} ${label}${hint}\n`);
      });
      if (footer) stdout.write(`\x1b[2m${footer}\x1b[0m\n`);
    };

    const cleanup = () => {
      stdout.write("\x1b[?25h");
      process.stdin.setRawMode(false);
      process.stdin.removeListener("keypress", onKey);
      process.stdin.pause();
    };

    const onKey = (_str: string | undefined, key: readline.Key | undefined) => {
      if (!key) return;
      if (key.name === "up" || (key.ctrl && key.name === "p")) {
        active = (active - 1 + choices.length) % choices.length;
        render();
      } else if (key.name === "down" || (key.ctrl && key.name === "n")) {
        active = (active + 1) % choices.length;
        render();
      } else if (key.name === "return") {
        cleanup();
        resolve(active);
      } else if (key.ctrl && key.name === "c") {
        cleanup();
        process.exit(130);
      }
    };

    process.stdin.on("keypress", onKey);
    render();
  });
}
