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
omp plugin install github:trozzelle/sticky#v0.1.0   # a release (recommended)
omp plugin install github:trozzelle/sticky          # tracks main
```

Start a new `omp` session (or `/reload`) after installing. `omp plugin upgrade omp-sticky` re-resolves the ref you installed: a `main` install picks up new commits, a tag install stays put. To move to a newer release, reinstall with its tag. Releases and their notes are listed on the [releases page](https://github.com/trozzelle/sticky/releases) and in [CHANGELOG.md](CHANGELOG.md).

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

## Releasing

Versions follow [SemVer](https://semver.org) and are cut by [release-please](https://github.com/googleapis/release-please) from [Conventional Commits](https://www.conventionalcommits.org) on `main`:

| Commit | Effect (while < 1.0) |
|---|---|
| `fix: …` | patch bump |
| `feat: …` | minor bump |
| `feat!: …` / `BREAKING CHANGE:` footer | minor bump |
| `chore:`, `docs:`, `test:`, `ci:`, … | no release |

release-please keeps a release PR open that bumps `package.json` and `CHANGELOG.md`. Merging it tags `vX.Y.Z` and publishes a GitHub release.

## License

MIT
