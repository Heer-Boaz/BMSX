/** Search representation and its mapping back to original UTF-16 text offsets. */
export class CaseFoldedText {
	public readonly lower: string;
	private readonly sourceOffsets: number[] | undefined;

	public constructor(public readonly text: string) {
		this.lower = text.toLowerCase();
		if (this.lower.length !== text.length) {
			const offsets: number[] = [];
			for (let index = 0; index < text.length; index += 1) {
				const length = text[index].toLowerCase().length;
				for (let unit = 0; unit < length; unit += 1) offsets.push(index);
			}
			this.sourceOffsets = offsets;
		}
	}

	public sourceStart(offset: number): number { return this.sourceOffsets === undefined ? offset : this.sourceOffsets[offset]; }
	public sourceEnd(offset: number): number { return this.sourceOffsets === undefined ? offset : this.sourceOffsets[offset - 1] + 1; }
}

const LITERAL_SEARCH_WINDOW = 8192;
const LITERAL_SEARCH_MATCHES_PER_STEP = 256;

function splitsSurrogatePair(source: string, offset: number): boolean {
	const previous = source.charCodeAt(offset - 1), next = source.charCodeAt(offset);
	return previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff;
}

/** Literal matching keeps original UTF-16 coordinates; insensitive matching uses Unicode simple folding. */
export class LiteralTextMatcher {
	private readonly expression: RegExp | undefined;
	private readonly maximumMatchLength: number;

	public constructor(private readonly query: string, matchCase: boolean) {
		if (matchCase) this.maximumMatchLength = query.length;
		else {
			this.expression = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
			let codePoints = 0;
			for (let offset = 0; offset < query.length; offset++, codePoints++) if (splitsSurrogatePair(query, offset + 1)) offset++;
			// A simple fold consumes one source code point for each literal query code point.
			this.maximumMatchLength = codePoints * 2;
		}
	}

	public createCursor(source: string): LiteralTextSearchCursor {
		return new LiteralTextSearchCursor(source, this.query, this.expression, this.maximumMatchLength);
	}
}

/** A step scans at most one window plus pattern overlap, or emits one bounded match batch. */
export class LiteralTextSearchCursor {
	private offsetValue = 0;
	private window: string | undefined;
	private windowStart = 0;
	private searchEnd = 0;
	private readonly stride: number;
	public get offset(): number { return this.offsetValue; }

	public constructor(private readonly source: string, private readonly query: string,
		private readonly expression: RegExp | undefined, private readonly maximumMatchLength: number) {
		this.stride = Math.max(LITERAL_SEARCH_WINDOW, maximumMatchLength);
		if (query.length === 0) this.offsetValue = source.length;
	}

	/** Returns true while scanning remains. Match offsets and ends address the original source. */
	public step(onMatch: (offset: number, end: number) => void): boolean {
		if (this.offsetValue >= this.source.length) return false;
		if (this.window === undefined) {
			this.windowStart = this.offsetValue;
			this.searchEnd = Math.min(this.source.length, this.windowStart + this.stride);
			if (splitsSurrogatePair(this.source, this.searchEnd)) this.searchEnd++;
			let end = Math.min(this.source.length, this.searchEnd + this.maximumMatchLength - 1);
			if (splitsSurrogatePair(this.source, end)) end++;
			this.window = this.source.slice(this.windowStart, end);
		}
		for (let count = 0; count < LITERAL_SEARCH_MATCHES_PER_STEP; count++) {
			let start: number, end: number;
			if (this.expression === undefined) {
				start = this.window.indexOf(this.query, this.offsetValue - this.windowStart);
				end = start + this.query.length;
			} else {
				this.expression.lastIndex = this.offsetValue - this.windowStart;
				const match = this.expression.exec(this.window);
				start = match === null ? -1 : match.index;
				end = match === null ? -1 : match.index + match[0].length;
			}
			if (start < 0 || this.windowStart + start >= this.searchEnd) {
				this.offsetValue = this.searchEnd; this.window = undefined;
				return this.offsetValue < this.source.length;
			}
			start += this.windowStart; end += this.windowStart;
			this.offsetValue = end;
			onMatch(start, end);
			if (this.offsetValue >= this.searchEnd) {
				this.window = undefined;
				return this.offsetValue < this.source.length;
			}
		}
		return true;
	}
}

export type TextSearchSnippet = { readonly text: string; readonly matchStart: number; readonly matchEnd: number };

/** Bounded original-text preview; returned highlight coordinates include any leading ellipsis. */
export function buildTextSearchSnippet(source: string, offset: number, matchLength: number, context = 32): TextSearchSnippet {
	let start = Math.max(0, offset - context);
	let end = Math.min(source.length, offset + Math.min(matchLength, context * 2) + context);
	for (let index = offset - 1; index >= start; index--) if (source.charCodeAt(index) === 10 || source.charCodeAt(index) === 13) { start = index + 1; break; }
	for (let index = offset; index < end; index++) if (source.charCodeAt(index) === 10 || source.charCodeAt(index) === 13) { end = index; break; }
	if (splitsSurrogatePair(source, start)) start--;
	if (splitsSurrogatePair(source, end)) end++;
	const before = start > 0 && source.charCodeAt(start - 1) !== 10 && source.charCodeAt(start - 1) !== 13 ? '…' : '';
	const after = end < source.length && source.charCodeAt(end) !== 10 && source.charCodeAt(end) !== 13 ? '…' : '';
	return { text: before + source.slice(start, end) + after,
		matchStart: before.length + offset - start, matchEnd: before.length + Math.min(offset + matchLength, end) - start };
}
