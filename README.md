# sticky

Pin short steering context to every agent turn in [oh-my-pi](https://github.com/can1357/oh-my-pi) (`omp`) — for as long as the `omp` process is running, and no longer.

```
/sticky we are comparing two data pipelines; only latency matters
```

The pin is injected into every subsequent turn, including after `/new`, resume and fork. It is never written to disk: quitting `omp` (or a crash) drops it. Use `AGENTS.md` or memory for anything that should outlive the process.

## Usage

| Input | Effect |
|---|---|
| `/sticky <text>` | Set (or replace) the pinned context |
| `/sticky` | Show the current pin |
| `/unsticky` | Clear it |
| `alt+s` | Expand/collapse the widget (interactive TUI) |

In the TUI the pin is shown above the editor, capped at a quarter of the terminal width (minimum 32 columns):

```
 Sticky: we are comparing t… (+1 · alt+s)
```

`alt+s` expands it to the full text, wrapped within the same width. On macOS, `alt+s` requires your terminal to send Option as Meta.

In RPC mode the pin is still injected; only the widget is skipped.

## Install

```sh
omp plugin install github:trozzelle/sticky
```

Pin a tag or commit with `github:trozzelle/sticky#<ref>`. Start a new `omp` session (or `/reload`) after installing.

Tested against omp 18.6.3.

## Development

Requires [Bun](https://bun.sh).

```sh
bun install
bun run check          # tsc --noEmit + bun test
omp plugin link .      # load this checkout into omp; restart omp to pick up edits
```

Don't also copy `sticky.ts` into `~/.omp/agent/extensions/` while linked: omp de-duplicates by path, so a copy and a link would both load.

`@oh-my-pi/*` packages are dev dependencies only. At runtime omp resolves those imports to its own bundled copies, so keep their pinned versions in step with the omp release you test against.

## License

MIT
