# sticky

Pin short steering context to every agent turn in [oh-my-pi](https://github.com/can1357/oh-my-pi) (`omp`) for the life of the `omp` process.

```
/sticky we are comparing two data pipelines; only latency matters
```

The pin survives `/new`, resume and fork, but is never written to disk: quitting `omp` drops it. Use `AGENTS.md` or memory for anything that should persist.

## Usage

| Input | Effect |
|---|---|
| `/sticky <text>` | Set or replace the pin |
| `/sticky` | Show the pin |
| `/unsticky` | Clear the pin |
| `alt+s` | Expand/collapse the widget |

The TUI shows the pin above the editor, collapsed to one row (on macOS, `alt+s` needs Option sent as Meta):

```
 Sticky: we are comparing t… (+1 · alt+s)
```

## Install

```sh
omp install github:trozzelle/sticky#v0.1.0
```

Then start a new session or `/reload`. Omit `#v0.1.0` to track `main`. See [releases](https://github.com/trozzelle/sticky/releases) for newer tags. Tested against omp 18.6.3.

## License

MIT
