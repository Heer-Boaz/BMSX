import { forEachWrappedMeasuredRange, writeWrappedSourceLine } from '../text';
import { TextStyle, type MarkdownBlock, type MarkdownLine, type StyledSpan } from './model';

export type StyledMeasure = (text: string, start: number, end: number, style: TextStyle) => number;
export type MarkdownRun = { text: string; x: number; width: number; style: TextStyle };
export type MarkdownRow = { text: string; runs: MarkdownRun[]; offset: number; inset: number; code: boolean };
type BlockLayout = { revision: number; rows: MarkdownRow[] };

/** Layout lifetime is independent of source parsing: a resize remeasures, it does not reparse. */
export class MarkdownLayout {
	private readonly blocks = new WeakMap<MarkdownBlock, BlockLayout>();
	private readonly lines = new WeakMap<MarkdownLine, BlockLayout>();
	public constructor(private readonly width: number, private readonly measure: StyledMeasure) {}
	public layout(block: MarkdownBlock): readonly MarkdownRow[] {
		let cached = this.blocks.get(block);
		if (cached) {
			if (cached.revision === block.revision) return cached.rows;
			cached.rows.length = block.separated ? 1 : 0;
		} else {
			cached = { revision: block.revision, rows: [] };
			if (block.separated) cached.rows.push({ text: '', runs: [], offset: 0, inset: 0, code: false });
			this.blocks.set(block, cached);
		}
		const rows = cached.rows;
		for (const line of block.lines) for (const row of this.layoutLine(line)) rows.push(row);
		cached.revision = block.revision;
		return rows;
	}

	private layoutLine(line: MarkdownLine): readonly MarkdownRow[] {
		let cached = this.lines.get(line);
		let start = 0;
		if (cached) {
			if (cached.revision === line.revision) return cached.rows;
			start = cached.rows.at(-1)!.offset; cached.rows.pop();
		} else {
			cached = { revision: line.revision, rows: [] };
			this.lines.set(line, cached);
		}
		const rows = cached.rows;
		const prefixes = line.prefixes.map(prefix => ({ ...prefix, width: this.measure(prefix.text, 0, prefix.text.length, TextStyle.Plain) }));
		let left = 0;
		for (const prefix of prefixes) left += prefix.width;
		const text = line.spans.length === 1 ? line.spans[0].text : line.spans.map(span => span.text).join('');
		let lineOffset = start, first = start === 0;
		const spans: { span: StyledSpan; start: number; end: number }[] = [];
		let spanOffset = 0;
		for (const span of line.spans) { spans.push({ span, start: spanOffset, end: spanOffset + span.text.length }); spanOffset += span.text.length; }
		let measuringSpan = 0;
		const measure = (_: string, from: number, to: number) => {
			from += lineOffset; to += lineOffset;
			while (measuringSpan > 0 && spans[measuringSpan].start > from) measuringSpan--;
			while (measuringSpan + 1 < spans.length && spans[measuringSpan].end <= from) measuringSpan++;
			return this.measure(text, from, to, spans[measuringSpan].span.style);
		};
		const emit = (from: number, to: number) => {
			from += lineOffset; to += lineOffset;
			const runs: MarkdownRun[] = [];
			let x = 0;
			for (const prefix of prefixes) {
				if (prefix.repeat || first && prefix.first) runs.push({ text: prefix.text, x, width: prefix.width, style: TextStyle.Plain });
				x += prefix.width;
			}
			for (const part of spans) {
				if (part.end <= from) continue;
				if (part.start >= to) break;
				const a = Math.max(from, part.start), b = Math.min(to, part.end);
				const width = this.measure(text, a, b, part.span.style);
				runs.push({ text: text.slice(a, b), x, width, style: part.span.style }); x += width;
			}
			rows.push({ text: text.slice(from, to), runs, offset: from, inset: left, code: line.code });
			first = false;
		};
		// disable-next-line newline_normalization_pattern -- Parsed Markdown hard breaks create visual lines; source remains unchanged.
		for (const part of text.slice(start).split('\n')) {
			if (line.code) {
				const wrapped: string[] = [];
				writeWrappedSourceLine(wrapped, part, this.width - left, measure);
				let offset = 0;
				for (const segment of wrapped) { emit(offset, offset + segment.length); offset += segment.length; }
			} else forEachWrappedMeasuredRange(part, this.width - left, measure, emit);
			lineOffset += part.length + 1;
		}
		cached.revision = line.revision;
		return rows;
	}
}
