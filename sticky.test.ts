/**
 * Behavior tests for the sticky extension. The factory is driven with a fake
 * ExtensionAPI; widget rows are rendered through the real @oh-my-pi/pi-tui
 * width/wrap helpers, so layout assertions match what omp draws.
 */

import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@oh-my-pi/pi-tui";
import createSticky from "./sticky.ts";

type Handler = (event: unknown, ctx: unknown) => Promise<unknown>;

interface FakeCommand {
	description: string;
	handler: (args: string, ctx: unknown) => Promise<void>;
}

interface FakeShortcut {
	description?: string;
	handler: (ctx: unknown) => Promise<void> | void;
}

interface FakeTheme {
	fg: (color: string, text: string) => string;
	bold: (text: string) => string;
}

type WidgetFactory = (tui: unknown, theme: FakeTheme) => { render(width: number): readonly string[] };

interface InjectedMessage {
	message: { customType: string; content: string; display: boolean };
}

/** Identity theme: rows contain only visible text, so widths can be asserted directly. */
const PLAIN_THEME: FakeTheme = { fg: (_color, text) => text, bold: text => text };

/** Instantiate the extension against a fake ExtensionAPI and expose what it registered. */
function setup() {
	// Registries are filled at runtime by the extension, so Map fits here.
	const commands = new Map<string, FakeCommand>();
	const handlers = new Map<string, Handler[]>();
	const shortcuts = new Map<string, FakeShortcut>();
	const widgetCalls: Array<{ key: string; content: WidgetFactory | undefined }> = [];

	const ctx = {
		hasUI: true,
		mode: "tui",
		ui: {
			notify: () => {},
			setWidget: (key: string, content: WidgetFactory | undefined) => {
				widgetCalls.push({ key, content });
			},
		},
	};

	createSticky({
		registerCommand: (name: string, options: FakeCommand) => commands.set(name, options),
		registerShortcut: (key: string, options: FakeShortcut) => shortcuts.set(key, options),
		on: (event: string, handler: Handler) => handlers.set(event, [...(handlers.get(event) ?? []), handler]),
	} as never);

	function lookup<T>(registry: Map<string, T>, key: string): T {
		const entry = registry.get(key);
		if (entry === undefined) throw new Error(`not registered: ${key}`);
		return entry;
	}

	return {
		ctx,
		widgetCalls,
		run: (name: string, args = "", runCtx: unknown = ctx) => lookup(commands, name).handler(args, runCtx),
		toggle: (runCtx: unknown = ctx) => lookup(shortcuts, "alt+s").handler(runCtx),
		emit: (event: string, payload: unknown = { type: event }) => {
			const [handler] = lookup(handlers, event);
			if (handler === undefined) throw new Error(`no handler for ${event}`);
			return handler(payload, ctx);
		},
		/** Render the most recent widget at `width` columns. */
		render: (width: number, theme: FakeTheme = PLAIN_THEME): readonly string[] => {
			const last = widgetCalls.at(-1);
			if (last?.content === undefined) throw new Error("no widget is set");
			return last.content(undefined, theme).render(width);
		},
	};
}

describe("context injection", () => {
	test("nothing is injected when nothing is pinned", async () => {
		const s = setup();
		expect(await s.emit("before_agent_start")).toBeUndefined();
	});

	test("/sticky pins text that is injected as a displayed custom message", async () => {
		const s = setup();
		await s.run("sticky", "Compare the two pipelines");
		const result = (await s.emit("before_agent_start")) as InjectedMessage;
		expect(result.message.customType).toBe("sticky-context");
		expect(result.message.display).toBe(true);
		expect(result.message.content).toContain("Compare the two pipelines");
	});

	test("the pin is injected on every turn, not just the first", async () => {
		const s = setup();
		await s.run("sticky", "long-lived context");
		for (let turn = 0; turn < 3; turn++) {
			const result = (await s.emit("before_agent_start")) as InjectedMessage;
			expect(result.message.content).toContain("long-lived context");
		}
	});

	test("bare /sticky does not set a pin", async () => {
		const s = setup();
		await s.run("sticky", "   ");
		expect(await s.emit("before_agent_start")).toBeUndefined();
	});

	test("/unsticky stops injection", async () => {
		const s = setup();
		await s.run("sticky", "temp context");
		await s.run("unsticky");
		expect(await s.emit("before_agent_start")).toBeUndefined();
	});
});

describe("collapsed widget", () => {
	test("a short single-line pin is one row with no hint", async () => {
		const s = setup();
		await s.run("sticky", "comparing two pipelines");
		expect(s.widgetCalls[0]?.key).toBe("sticky-context-widget");
		expect(s.render(80)).toEqual([" Sticky: comparing two pipelines"]);
	});

	test("a multi-line pin shows the first line and the hidden-line count", async () => {
		const s = setup();
		await s.run("sticky", "first\nsecond\nthird");
		expect(s.render(80)).toEqual([" Sticky: first (+2 · alt+s)"]);
	});

	test("label is bold in the custom-message label color; hint is dim", async () => {
		const s = setup();
		await s.run("sticky", "first\nsecond");
		const tagging: FakeTheme = { fg: (color, text) => `<${color}>${text}</${color}>`, bold: text => `<b>${text}</b>` };
		expect(s.render(80, tagging)).toEqual([
			" <customMessageLabel><b>Sticky:</b></customMessageLabel> first<dim> (+1 · alt+s)</dim>",
		]);
	});

	test("a long line fills exactly a quarter of a wide terminal", async () => {
		const s = setup();
		await s.run("sticky", "y".repeat(300));
		const rows = s.render(200);
		expect(rows).toHaveLength(1);
		expect(visibleWidth(rows[0] ?? "")).toBe(1 + 50); // left pad + 200/4
		expect(rows[0]).toEndWith("… (alt+s)");
	});

	test("the quarter is floored at 32 columns on narrow terminals", async () => {
		const s = setup();
		await s.run("sticky", "y".repeat(300));
		expect(visibleWidth(s.render(80)[0] ?? "")).toBe(1 + 32); // 80/4 = 20 < 32
	});

	test("below the floor the hint is dropped rather than the text", async () => {
		const s = setup();
		await s.run("sticky", "abcdefghijklmnop\nmore");
		expect(s.render(20)).toEqual([" Sticky: abcdefghi…"]); // inner width 18
	});

	test("double-width characters are measured by display width", async () => {
		const s = setup();
		await s.run("sticky", "漢字".repeat(100));
		expect(visibleWidth(s.render(200)[0] ?? "")).toBeLessThanOrEqual(1 + 50);
	});
});

describe("expanded widget (alt+s)", () => {
	test("shows every line under the label and collapses back", async () => {
		const s = setup();
		await s.run("sticky", "first\nsecond");
		await s.toggle();
		expect(s.render(80)).toEqual([" Sticky: first", "         second", "         alt+s to collapse"]);
		await s.toggle();
		expect(s.render(80)).toEqual([" Sticky: first (+1 · alt+s)"]);
	});

	test("wraps at word boundaries with a hanging indent", async () => {
		const s = setup();
		await s.run("sticky", "lorem ipsum dolor sit amet consectetur");
		await s.toggle();
		// width 30 → inner 28 → 20 text columns after the 8-column label
		expect(s.render(30)).toEqual([" Sticky: lorem ipsum dolor", "         sit amet consectetur", "         alt+s to collapse"]);
	});

	test("stays within a quarter of a wide terminal", async () => {
		const s = setup();
		await s.run("sticky", "z".repeat(100));
		await s.toggle();
		// width 200 → budget 50 → 42 text columns after the label
		const rows = s.render(200);
		expect(rows).toEqual([
			` Sticky: ${"z".repeat(42)}`,
			`         ${"z".repeat(42)}`,
			`         ${"z".repeat(16)}`,
			"         alt+s to collapse",
		]);
		expect(Math.max(...rows.map(visibleWidth))).toBe(1 + 50);
	});

	test("expanded state survives replacing the pin", async () => {
		const s = setup();
		await s.run("sticky", "old");
		await s.toggle();
		await s.run("sticky", "new\nlines");
		expect(s.render(80)).toHaveLength(3);
	});

	test("alt+s with nothing pinned leaves the widget alone", async () => {
		const s = setup();
		await s.toggle();
		expect(s.widgetCalls).toHaveLength(0);
	});
});

describe("widget lifecycle", () => {
	test("/unsticky removes the widget", async () => {
		const s = setup();
		await s.run("sticky", "temp");
		await s.run("unsticky");
		expect(s.widgetCalls.at(-1)).toEqual({ key: "sticky-context-widget", content: undefined });
	});

	test("session_start re-renders the pin for the new session", async () => {
		const s = setup();
		await s.run("sticky", "carried context");
		const before = s.widgetCalls.length;
		await s.emit("session_start", { type: "session_start", reason: "new" });
		expect(s.widgetCalls).toHaveLength(before + 1);
		expect(s.render(80)).toEqual([" Sticky: carried context"]);
	});

	test("non-TUI modes never touch the widget", async () => {
		const s = setup();
		const rpcCtx = { ...s.ctx, mode: "rpc" };
		await s.run("sticky", "text", rpcCtx);
		await s.toggle(rpcCtx);
		expect(s.widgetCalls).toHaveLength(0);
	});

	test("a TUI context without UI never touches the widget", async () => {
		const s = setup();
		await s.run("sticky", "text", { ...s.ctx, hasUI: false });
		expect(s.widgetCalls).toHaveLength(0);
	});
});
