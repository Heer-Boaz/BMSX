import { clearLine, cursorTo } from 'node:readline';
import type { Writable } from 'node:stream';
import stringWidth from 'string-width';

const graphemes = new Intl.Segmenter();

/** Keep both the phase prefix and asset/path suffix, as Ninja does for long status lines. */
export function truncateTerminalText(text: string, maxWidth: number): string {
	if (stringWidth(text) <= maxWidth) return text;
	if (maxWidth <= 1) return '…'.slice(0, maxWidth);
	const leftWidth = (maxWidth - 1) >> 1;
	const rightWidth = maxWidth - 1 - leftWidth;
	const segments = graphemes.segment(text);
	let left = '', right = '';
	let width = 0;
	for (const { segment: char } of segments) {
		const charWidth = stringWidth(char);
		if (width + charWidth > leftWidth) break;
		left += char;
		width += charWidth;
	}
	width = 0;
	let end = text.length;
	while (end > 0) {
		const { segment, index } = segments.containing(end - 1)!;
		const charWidth = stringWidth(segment);
		if (width + charWidth > rightWidth) break;
		right = segment + right;
		width += charWidth;
		end = index;
	}
	return `${left}…${right}`;
}

/** The CLI's sole writer owns the transient line; diagnostics always start on a clean line. */
export class CliTerminal {
	private progressLine: string | undefined;
	public readonly interactiveProgress: boolean;

	constructor(private readonly output: Writable & { isTTY?: boolean; columns?: number } = process.stdout,
		private readonly errors: Writable = process.stderr) {
		this.interactiveProgress = !!output.isTTY && !process.env.CI && process.env.TERM !== 'dumb';
	}

	public get lineWidth(): number {
		return Math.max(1, (this.output.columns || 80) - 1);
	}

	public write(text: string, channel: 'stdout' | 'stderr' = 'stdout'): void {
		if (this.progressLine !== undefined) {
			cursorTo(this.output, 0);
			clearLine(this.output, 0);
		}
		(channel === 'stderr' ? this.errors : this.output).write(text);
		if (this.progressLine !== undefined) this.showProgress(this.progressLine);
	}

	public showProgress(line: string): void {
		if (!this.interactiveProgress) return;
		this.progressLine = line;
		cursorTo(this.output, 0);
		this.output.write(truncateTerminalText(line, this.lineWidth));
		clearLine(this.output, 1);
	}

	public stopProgress(): void {
		if (this.progressLine === undefined) return;
		cursorTo(this.output, 0);
		clearLine(this.output, 0);
		this.progressLine = undefined;
	}
}
