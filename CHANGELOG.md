# Changelog

## 0.1.0 (2026-10-11)

### Features

* `/sticky <text>` pins steering context that is injected into every agent turn, across `/new`, until the omp process exits; never written to disk.
* `/unsticky` clears the pin; bare `/sticky` shows it.
* TUI widget above the editor, capped at a quarter of the terminal width (minimum 32 columns), collapsed to one row; `alt+s` expands/collapses.
