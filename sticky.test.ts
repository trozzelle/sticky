/**
 * Throwaway mock-driven tests for the sticky extension.
 * Drives the extension factory with a mock ExtensionAPI and asserts behavior.
 */

import { assertEquals } from "jsr:@std/assert";
import { default as createSticky } from "./sticky.ts";

type Handler = (event: unknown, ctx: unknown) => Promise<unknown>;

interface MockCommand {
	description: string;
	handler: (args: string, ctx: unknown) => Promise<void>;
}

interface CapturedMessage {
	customType: string;
	content: string;
	display: boolean;
}

interface MockTheme {
	fg: (color: string, text: string) => string;
	bold: (text: string) => string;
}

type WidgetFactory = (tui: unknown, theme: MockTheme) => { render(width: number): readonly string[] };

/** Identity theme: rows contain only visible text, so widths can be asserted directly. */
const PLAIN_THEME: MockTheme = { fg: (_color, text) => text, bold: text => text };

interface MockShortcut {
	description?: string;
	handler: (ctx: unknown) => Promise<void> | void;
}

/** Build a mock ExtensionAPI capturing registrations. */
function makeMockPi() {
	// Command/event/shortcut registries are runtime-populated, so Map is the right structure here.
	const commands = new Map<string, MockCommand>();
	const handlers = new Map<string, Handler[]>();
	const shortcuts = new Map<string, MockShortcut>();
	const notifications: Array<{ message: string; type: string }> = [];
	const widgetCalls: Array<{ key: string; content: WidgetFactory | undefined }> = [];

	const ui = {
		notify: (message: string, type: string = "info") => {
			notifications.push({ message, type });
		},
		setWidget: (key: string, content: WidgetFactory | undefined) => {
			widgetCalls.push({ key, content });
		},
	};

	const pi = {
		registerCommand: (name: string, options: MockCommand) => {
			commands.set(name, options);
		},
		registerShortcut: (key: string, options: MockShortcut) => {
			shortcuts.set(key, options);
		},
		on: (event: string, handler: Handler) => {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
		},
	};

	const ctx = { ui, hasUI: true, mode: "tui" };

	return { pi, commands, handlers, shortcuts, notifications, widgetCalls, ctx };
}

/** Render the most recent widget at `width` columns. */
function renderLastWidget(
	widgetCalls: Array<{ content: WidgetFactory | undefined }>,
	width: number,
	theme: MockTheme = PLAIN_THEME,
): readonly string[] {
	const factory = widgetCalls[widgetCalls.length - 1].content;
	if (factory === undefined) throw new Error("last widget call removed the widget");
	return factory(undefined, theme).render(width);
}

Deno.test("sticky registers /sticky and /unsticky commands", () => {
	const { pi, commands } = makeMockPi();
	createSticky(pi as never);
	assertEquals(commands.has("sticky"), true);
	assertEquals(commands.has("unsticky"), true);
});

Deno.test("before_agent_start handler is registered", () => {
	const { pi, handlers } = makeMockPi();
	createSticky(pi as never);
	assertEquals((handlers.get("before_agent_start") ?? []).length, 1);
});

Deno.test("no injection when nothing pinned", async () => {
	const { pi, handlers } = makeMockPi();
	createSticky(pi as never);
	const handler = handlers.get("before_agent_start")![0];
	const result = await handler({ type: "before_agent_start", prompt: "hi" }, {});
	assertEquals(result, undefined);
});

Deno.test("/sticky sets state and next before_agent_start injects it", async () => {
	const { pi, commands, handlers, ctx } = makeMockPi();
	createSticky(pi as never);
	await commands.get("sticky")!.handler("Compare the two pipelines", ctx);
	const handler = handlers.get("before_agent_start")![0];
	const result = (await handler({ type: "before_agent_start", prompt: "hi" }, {})) as {
		message: CapturedMessage;
	};
	assertEquals(result.message.customType, "sticky-context");
	assertEquals(result.message.display, true);
	assertEquals(result.message.content.includes("Compare the two pipelines"), true);
	assertEquals(result.message.content.includes("pinned context"), true);
});

Deno.test("/sticky with no args does not inject", async () => {
	const { pi, commands, handlers, ctx } = makeMockPi();
	createSticky(pi as never);
	await commands.get("sticky")!.handler("", ctx);
	const handler = handlers.get("before_agent_start")![0];
	const result = await handler({ type: "before_agent_start", prompt: "hi" }, {});
	assertEquals(result, undefined);
});

Deno.test("/unsticky clears state and stops injection", async () => {
	const { pi, commands, handlers, ctx } = makeMockPi();
	createSticky(pi as never);
	await commands.get("sticky")!.handler("temp context", ctx);
	await commands.get("unsticky")!.handler("", ctx);
	const handler = handlers.get("before_agent_start")![0];
	const result = await handler({ type: "before_agent_start", prompt: "hi" }, {});
	assertEquals(result, undefined);
});

Deno.test("/unsticky with nothing pinned does not throw", async () => {
	const { pi, commands, ctx } = makeMockPi();
	createSticky(pi as never);
	await commands.get("unsticky")!.handler("", ctx);
});

Deno.test("state persists across multiple before_agent_start invocations (harness lifetime)", async () => {
	const { pi, commands, handlers, ctx } = makeMockPi();
	createSticky(pi as never);
	await commands.get("sticky")!.handler("long-lived context", ctx);
	const handler = handlers.get("before_agent_start")![0];
	const first = (await handler({ type: "before_agent_start", prompt: "a" }, {})) as { message: { content: string } };
	const second = (await handler({ type: "before_agent_start", prompt: "b" }, {})) as { message: { content: string } };
	assertEquals(first.message.content.includes("long-lived context"), true);
	assertEquals(second.message.content.includes("long-lived context"), true);
});

Deno.test("collapsed widget: short single-line pin renders as one row, no hint", async () => {
	const { pi, commands, widgetCalls, ctx } = makeMockPi();
	createSticky(pi as never);
	await commands.get("sticky")!.handler("comparing two pipelines", ctx);
	assertEquals(widgetCalls[0].key, "sticky-context-widget");
	assertEquals(renderLastWidget(widgetCalls, 80), [" Sticky: comparing two pipelines"]);
});

Deno.test("collapsed widget: multi-line pin shows first line plus hidden-line count", async () => {
	const { pi, commands, widgetCalls, ctx } = makeMockPi();
	createSticky(pi as never);
	await commands.get("sticky")!.handler("first\nsecond\nthird", ctx);
	assertEquals(renderLastWidget(widgetCalls, 80), [" Sticky: first (+2 · alt+s)"]);
});

Deno.test("collapsed widget: label is bold in the custom-message label color, hint is dim", async () => {
	const { pi, commands, widgetCalls, ctx } = makeMockPi();
	createSticky(pi as never);
	await commands.get("sticky")!.handler("first\nsecond", ctx);
	const tagging: MockTheme = { fg: (color, text) => `<${color}>${text}</${color}>`, bold: text => `<b>${text}</b>` };
	assertEquals(renderLastWidget(widgetCalls, 80, tagging), [
		" <customMessageLabel><b>Sticky:</b></customMessageLabel> first<dim> (+1 · alt+s)</dim>",
	]);
});

Deno.test("collapsed widget: long line fills exactly a quarter of a wide terminal", async () => {
	const { pi, commands, widgetCalls, ctx } = makeMockPi();
	createSticky(pi as never);
	await commands.get("sticky")!.handler("y".repeat(300), ctx);
	const rows = renderLastWidget(widgetCalls, 200);
	assertEquals(rows.length, 1);
	assertEquals(rows[0].length, 1 + 50); // left pad + 200/4
	assertEquals(rows[0].endsWith("… (alt+s)"), true);
});

Deno.test("collapsed widget: quarter width is floored so narrow terminals still show text", async () => {
	const { pi, commands, widgetCalls, ctx } = makeMockPi();
	createSticky(pi as never);
	await commands.get("sticky")!.handler("y".repeat(300), ctx);
	assertEquals(renderLastWidget(widgetCalls, 80)[0].length, 1 + 32); // 80/4 = 20 < floor 32
});

Deno.test("collapsed widget: narrower than the floor drops the hint rather than the text", async () => {
	const { pi, commands, widgetCalls, ctx } = makeMockPi();
	createSticky(pi as never);
	await commands.get("sticky")!.handler("abcdefghijklmnop\nmore", ctx);
	assertEquals(renderLastWidget(widgetCalls, 20), [" Sticky: abcdefghi…"]); // inner 18
});

Deno.test("alt+s expands to every line aligned under the prefix, and collapses back", async () => {
	const { pi, commands, shortcuts, widgetCalls, ctx } = makeMockPi();
	createSticky(pi as never);
	await commands.get("sticky")!.handler("first\nsecond", ctx);
	const toggle = shortcuts.get("alt+s");
	if (toggle === undefined) throw new Error("alt+s shortcut not registered");

	await toggle.handler(ctx);
	assertEquals(renderLastWidget(widgetCalls, 80), [
		" Sticky: first",
		"         second",
		"         alt+s to collapse",
	]);

	await toggle.handler(ctx);
	assertEquals(renderLastWidget(widgetCalls, 80), [" Sticky: first (+1 · alt+s)"]);
});

Deno.test("expanded widget wraps long lines with a hanging indent", async () => {
	const { pi, commands, shortcuts, widgetCalls, ctx } = makeMockPi();
	createSticky(pi as never);
	await commands.get("sticky")!.handler("z".repeat(30), ctx);
	await shortcuts.get("alt+s")!.handler(ctx);
	// width 30 → inner 28 → text column 20 after the 8-col prefix
	assertEquals(renderLastWidget(widgetCalls, 30), [
		` Sticky: ${"z".repeat(20)}`,
		`         ${"z".repeat(10)}`,
		"         alt+s to collapse",
	]);
});

Deno.test("expanded widget wraps within a quarter of a wide terminal", async () => {
	const { pi, commands, shortcuts, widgetCalls, ctx } = makeMockPi();
	createSticky(pi as never);
	await commands.get("sticky")!.handler("z".repeat(100), ctx);
	await shortcuts.get("alt+s")!.handler(ctx);
	// width 200 → budget 50 → text column 42 after the 8-col label
	const rows = renderLastWidget(widgetCalls, 200);
	assertEquals(rows, [
		` Sticky: ${"z".repeat(42)}`,
		`         ${"z".repeat(42)}`,
		`         ${"z".repeat(16)}`,
		"         alt+s to collapse",
	]);
	assertEquals(Math.max(...rows.map(row => row.length)), 1 + 50);
});

Deno.test("expanded state persists when the pin is replaced", async () => {
	const { pi, commands, shortcuts, widgetCalls, ctx } = makeMockPi();
	createSticky(pi as never);
	await commands.get("sticky")!.handler("old", ctx);
	await shortcuts.get("alt+s")!.handler(ctx);
	await commands.get("sticky")!.handler("new\nlines", ctx);
	assertEquals(renderLastWidget(widgetCalls, 80).length, 3);
});

Deno.test("alt+s does nothing when nothing is pinned", async () => {
	const { pi, shortcuts, widgetCalls, ctx } = makeMockPi();
	createSticky(pi as never);
	await shortcuts.get("alt+s")!.handler(ctx);
	assertEquals(widgetCalls.length, 0);
});

Deno.test("/unsticky removes the widget", async () => {
	const { pi, commands, widgetCalls, ctx } = makeMockPi();
	createSticky(pi as never);
	await commands.get("sticky")!.handler("temp", ctx);
	await commands.get("unsticky")!.handler("", ctx);
	assertEquals(widgetCalls.length, 2);
	assertEquals(widgetCalls[1].key, "sticky-context-widget");
	assertEquals(widgetCalls[1].content, undefined);
});

Deno.test("widget is not touched in non-TUI context", async () => {
	const { pi, commands, shortcuts, widgetCalls, ctx } = makeMockPi();
	createSticky(pi as never);
	const rpcCtx = { ...ctx, mode: "rpc" };
	await commands.get("sticky")!.handler("text", rpcCtx);
	await shortcuts.get("alt+s")!.handler(rpcCtx);
	assertEquals(widgetCalls.length, 0);
});

Deno.test("widget is not touched when hasUI is false", async () => {
	const { pi, commands, widgetCalls, ctx } = makeMockPi();
	createSticky(pi as never);
	await commands.get("sticky")!.handler("text", { ...ctx, hasUI: false });
	assertEquals(widgetCalls.length, 0);
});

Deno.test("session_start re-renders the widget for the new session", async () => {
	const { pi, commands, handlers, widgetCalls, ctx } = makeMockPi();
	createSticky(pi as never);
	await commands.get("sticky")!.handler("carried context", ctx);
	const startHandlers = handlers.get("session_start") ?? [];
	assertEquals(startHandlers.length, 1);
	const before = widgetCalls.length;
	await startHandlers[0]({ type: "session_start", reason: "new" }, ctx);
	assertEquals(widgetCalls.length, before + 1);
	assertEquals(renderLastWidget(widgetCalls, 80), [" Sticky: carried context"]);
});
