# CLAUDE.md

## Getting Started

Always read `README.md` first before starting any task.

## Documentation

When making architectural changes, update `README.md` to reflect the new state.

## Code comments

Default: write no comments. Well-named identifiers already explain WHAT.

Only add a comment when the WHY is non-obvious and would confuse a future reader without it — a hidden constraint, a subtle invariant, a workaround for a specific bug, or behavior that would surprise someone reading the code cold.

Keep comments timeless:
- Don't reference callers, task names, PRs, issue numbers, or "used by X". That context belongs in commit messages and PR descriptions, and rots as the codebase evolves.
- Don't narrate the current change ("added for the Y flow", "removed ...").
- Don't restate type signatures or function names in prose.

When a comment earns its place, keep it short — one or two lines is almost always enough. If a block of code needs a paragraph to explain, consider whether the code itself should be clearer.
