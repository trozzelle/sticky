/**
 * Sticky — harness-lifetime pinned context for OMP.
 *
 * `/sticky <text>` pins a piece of context that is injected into every subsequent
 * agent turn (any session, any `/new`) for as long as this harness process
 * lives. It is never written to disk: closing the harness (or a crash) drops it.
 *
 * - `/sticky <text>`  set the pinned context
 * - `/sticky`         show the current pinned context
 * - `/unsticky`       clear it
 * - `alt+s`           expand/collapse the widget (interactive TUI)
 *
 * (Named /sticky, not /pin — /pin is a built-in session-resume command.)
 *
 * In interactive TUI sessions the current pin is also rendered as a widget
 * above the editor, labelled "Sticky:" in the theme's custom-message label
 * color. The widget never exceeds a quarter of the terminal width — it is for
 * short steering context, not bulk notes. It is collapsed to one row by default
 * (first line, truncated, with a hint when there is more); `alt+s` expands it
 * to the full text wrapped within the same width.
 *
 * The state lives in a module-level variable, which OMP shares across all
 * sessions in one process (parent sessions, subagents, `/new` clones), so the
 * pin survives session switches but not process exit.
 */

import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import type { Component } from "@oh-my-pi/pi-tui";
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@oh-my-pi/pi-tui";

const CUSTOM_TYPE = "sticky-context";
const WIDGET_KEY = "sticky-context-widget";
const LABEL = "Sticky:";
/** Columns taken by the label plus the space after it. */
const LABEL_WIDTH = LABEL.length + 1;
const TOGGLE_KEY = "alt+s";
/**
 * Floor for the widget width so label + hint + a few words still fit on
 * narrow terminals, where a strict quarter would leave no room for text.
 */
const MIN_WIDGET_WIDTH = 32;

interface StickyState {
	text: string | null;
	expanded: boolean;
}

interface StickyStyle {
	/** Styled "Sticky:" label (no trailing space). */
	label: string;
	dim: (s: string) => string;
}

/**
 * Rows for the widget at `width` columns, with one column of left padding as
 * omp's string widgets use. Every row fits in a budget of a quarter of the
 * width (floored at MIN_WIDGET_WIDTH, capped at the available width).
 * Collapsed: exactly one row — label, first line truncated, then a dim hint
 * whenever anything is hidden.
 * Expanded: every line wrapped within the budget with a hanging indent under
 * the label, then a dim collapse hint.
 */
function renderStickyRows(text: string, expanded: boolean, width: number, style: StickyStyle): string[] {
	const inner = Math.max(1, width - 2);
	const budget = Math.min(inner, Math.max(MIN_WIDGET_WIDTH, Math.floor(width / 4)));
	const lines = text.split("\n");
	const indent = " ".repeat(LABEL_WIDTH);

	if (expanded) {
		const textWidth = Math.max(1, budget - LABEL_WIDTH);
		const rows = lines.flatMap((line, i) =>
			wrapTextWithAnsi(line, textWidth).map((seg, j) => (i === 0 && j === 0 ? `${style.label} ` : indent) + seg),
		);
		rows.push(style.dim(truncateToWidth(`${indent}${TOGGLE_KEY} to collapse`, budget)));
		return rows.map(row => ` ${row}`);
	}

	const first = lines[0] ?? "";
	const hidden = lines.length - 1;
	if (hidden === 0 && LABEL_WIDTH + visibleWidth(first) <= budget) return [` ${style.label} ${first}`];

	const hint = hidden > 0 ? ` (+${hidden} · ${TOGGLE_KEY})` : ` (${TOGGLE_KEY})`;
	const room = budget - LABEL_WIDTH - visibleWidth(hint);
	// Too narrow for text + hint: give the hint's space back to the text.
	if (room < 1) return [` ${style.label} ${truncateToWidth(first, Math.max(0, budget - LABEL_WIDTH))}`];
	return [` ${style.label} ${truncateToWidth(first, room)}${style.dim(hint)}`];
}

/** Component wrapper caching rows per width, as pi-tui components are expected to. */
function stickyWidget(text: string, expanded: boolean, style: StickyStyle): Component {
	let cachedWidth = -1;
	let cachedRows: string[] = [];
	return {
		render(width: number): readonly string[] {
			if (width !== cachedWidth) {
				cachedRows = renderStickyRows(text, expanded, width, style);
				cachedWidth = width;
			}
			return cachedRows;
		},
		invalidate(): void {
			cachedWidth = -1;
		},
	};
}

export default function stickyExtension(pi: ExtensionAPI) {
	const state: StickyState = { text: null, expanded: false };

	/** Render (or remove) the widget. No-op outside the interactive TUI. */
	function updateWidget(ctx: Pick<ExtensionContext, "hasUI" | "mode" | "ui">): void {
		if (ctx.mode !== "tui" || !ctx.hasUI) return;
		const text = state.text;
		if (text === null) {
			ctx.ui.setWidget(WIDGET_KEY, undefined);
			return;
		}
		const expanded = state.expanded;
		ctx.ui.setWidget(WIDGET_KEY, (_tui, theme) =>
			stickyWidget(text, expanded, {
				label: theme.fg("customMessageLabel", theme.bold(LABEL)),
				dim: s => theme.fg("dim", s),
			}),
		);
	}

	pi.registerCommand("sticky", {
		description: "Pin ephemeral context for this harness session (usage: /sticky [text])",
		handler: async (args, ctx) => {
			const text = args.trim();
			if (text) {
				state.text = text;
				ctx.ui.notify("Pinned context set for this harness session.", "info");
			} else if (state.text) {
				ctx.ui.notify(`Pinned context:\n${state.text}`, "info");
			} else {
				ctx.ui.notify("No pinned context. Use /sticky <text> to set one.", "info");
			}
			updateWidget(ctx);
		},
	});

	pi.registerCommand("unsticky", {
		description: "Clear the pinned harness context",
		handler: async (_args, ctx) => {
			if (!state.text) {
				ctx.ui.notify("No pinned context to clear.", "info");
				return;
			}
			state.text = null;
			ctx.ui.notify("Pinned context cleared.", "info");
			updateWidget(ctx);
		},
	});

	pi.registerShortcut(TOGGLE_KEY, {
		description: "Expand/collapse the sticky context widget",
		handler: ctx => {
			if (state.text === null) return;
			state.expanded = !state.expanded;
			updateWidget(ctx);
		},
	});

	// Re-render the widget when a session starts (startup, /new, resume, fork):
	// the widget surface belongs to the session UI, so a new session needs a
	// fresh setWidget call for the pin to stay visible.
	pi.on("session_start", async (_event, ctx) => {
		updateWidget(ctx);
	});

	// Inject the pinned context as a custom message ahead of every agent run.
	pi.on("before_agent_start", async () => {
		if (!state.text) return;
		return {
			message: {
				customType: CUSTOM_TYPE,
				content: `[pinned context — set via /sticky, lives until this harness process exits]\n\n${state.text}`,
				display: true,
			},
		};
	});
}
