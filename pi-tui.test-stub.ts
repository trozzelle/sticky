/**
 * Test-only stand-in for the `@oh-my-pi/pi-tui` runtime exports sticky.ts uses.
 * The real package ships TypeScript sources under node_modules, which Deno
 * refuses to type-strip, so `deno test` maps the specifier here (deno.test.json).
 * ASCII-only semantics matching the real helpers for plain text: width = length,
 * truncation ends in "…" within maxWidth, wrapping is a hard split.
 */

export interface Component {
	render(width: number): readonly string[];
	invalidate?(): void;
}

export function visibleWidth(text: string): number {
	return text.length;
}

export function truncateToWidth(text: string, maxWidth: number): string {
	if (text.length <= maxWidth) return text;
	return maxWidth <= 0 ? "" : `${text.slice(0, maxWidth - 1)}…`;
}

export function wrapTextWithAnsi(text: string, width: number): string[] {
	if (text.length === 0) return [""];
	const rows: string[] = [];
	for (let i = 0; i < text.length; i += width) rows.push(text.slice(i, i + width));
	return rows;
}
