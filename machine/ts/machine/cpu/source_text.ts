import type { SourceRange } from './cpu';

export function extractSourceRangeText(range: SourceRange, source: string): string | null {
	if (range.start.line <= 0 || range.end.line < range.start.line) {
		return null;
	}
	let line = 1;
	let lineStart = 0;
	let out = '';
	for (let index = 0; index <= source.length; index += 1) {
		if (index < source.length && source.charCodeAt(index) !== 10) {
			continue;
		}
		let lineEnd = index;
		if (lineEnd > lineStart && source.charCodeAt(lineEnd - 1) === 13) {
			lineEnd -= 1;
		}
		if (line >= range.start.line && line <= range.end.line) {
			if (out.length !== 0) {
				out += ' ';
			}
			out += source.slice(lineStart, lineEnd);
			if (line === range.end.line) {
				return out;
			}
		}
		line += 1;
		lineStart = index + 1;
	}
	return null;
}
