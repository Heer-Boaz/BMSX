import { decodeHTMLStrict } from 'entities';
import { Lexer, type Token } from 'marked';

export const enum TextStyle { Plain = 0, Bold = 1, Italic = 2, Code = 4, Strike = 8, Link = 16, Muted = 32 }
export type StyledSpan = { text: string; style: TextStyle };
export type MarkdownPrefix = { text: string; first: boolean; repeat: boolean };
export type MarkdownTextLine = { kind: 'text'; revision: number; spans: StyledSpan[]; prefixes: readonly MarkdownPrefix[]; code: boolean };
export type MarkdownTable = { kind: 'table'; revision: number; prefixes: readonly MarkdownPrefix[];
	alignments: ('left' | 'center' | 'right' | null)[]; rows: MarkdownTextLine[][] };
export type MarkdownLine = MarkdownTextLine | MarkdownTable;
export type MarkdownBlock = { type: string; start: number; end: number; lines: MarkdownLine[]; plain?: MarkdownTextLine; separated: boolean; revision: number };

/** Source-backed, inert Markdown. Raw HTML is text; destinations are never loaded or executed. */
export class MarkdownDocument {
	public constructor(private readonly format: 'markdown' | 'text' = 'markdown') {}
	public readonly blocks: MarkdownBlock[] = [];
	public source = '';
	private endedWithCR = false;
	private references = false;
	private mutable = 0;
	private lineStart = 0;
	public append(raw: string): void {
		if (raw.length === 0) return;
		// disable-next-line newline_normalization_pattern -- CommonMark parser boundary, including CRLF split across streamed chunks; the source buffer is untouched.
		const text = (this.endedWithCR && raw.startsWith('\n') ? raw.slice(1) : raw).replace(/\r\n|\r/g, '\n');
		this.endedWithCR = raw.endsWith('\r');
		const newline = text.lastIndexOf('\n');
		if (newline !== -1) this.lineStart = this.source.length + newline + 1;
		this.source += text;
		const last = this.blocks.at(-1);
		if (this.format === 'text') {
			if (last) {
				last.plain!.spans[0].text += text; last.plain!.revision++; last.end += text.length; last.revision++;
			} else {
				const line: MarkdownTextLine = { kind: 'text', spans: [{ text, style: TextStyle.Plain }], prefixes: [], code: false, revision: 0 };
				this.blocks.push({ type: 'text', start: 0, end: text.length, plain: line, separated: false, revision: 0, lines: [line] });
			}
			return;
		}
		// No Markdown delimiter, newline or punctuation can be introduced by this append.
		// Keep the plain paragraph and its wrapped prefix; a delimiter takes the parser path.
		if (last?.plain && last.end === this.source.length - text.length && /^[\p{L}\p{N}\p{M} \t]+$/u.test(text)) {
			last.plain.spans[0].text += text; last.plain.revision++; last.end += text.length; last.revision++; return;
		}
		const start = this.references ? 0 : this.blocks[this.mutable]?.start ?? 0;
		let tokens = Lexer.lex(this.source.slice(start), { gfm: true });
		if (Object.keys(tokens.links).length > 0) {
			this.references = true;
			if (start !== 0) tokens = Lexer.lex(this.source, { gfm: true });
		}
		const previous = this.blocks.splice(this.references ? 0 : this.mutable);
		let retained = 0;
		let offset = this.references ? 0 : start;
		for (const token of tokens) {
			const lines: MarkdownLine[] = [];
			if (token.type !== 'space') blockLines(token, lines, []);
			if (lines.length > 0) {
				// Retain unchanged parsed lines even inside an unfinished fenced block/list.
				// Later delimiters can change semantics; only equal styled prefixes survive.
				while (retained < previous.length && previous[retained].start < offset) retained++;
				const before = this.references ? undefined : previous[retained];
				if (before?.start === offset) {
					for (let index = 0; index < lines.length && index < before.lines.length; index++) lines[index] = retainLine(before.lines[index], lines[index]);
				}
				const plain = token.type === 'paragraph' && /^[\p{L}\p{N}\p{M} \t]+$/u.test(token.raw) ? lines[0] as MarkdownTextLine : undefined;
				if (before?.start === offset) {
					before.type = token.type; before.lines = lines; before.end = offset + token.raw.length; before.plain = plain; before.revision++; this.blocks.push(before);
				} else this.blocks.push({ type: token.type, start: offset, end: offset + token.raw.length, lines, plain, separated: this.blocks.length > 0, revision: 0 });
			}
			offset += token.raw.length;
		}
		this.mutable = Math.max(0, this.blocks.length - 1);
		// An incomplete first line cannot commit the preceding block: "2" may
		// still become "2. item" and join a list rather than start a paragraph.
		// Code, headings and rules already followed by another block cannot absorb
		// that line. In particular, do not reparse a completed code listing while
		// its following explanation streams without a newline.
		if (this.mutable > 0 && this.blocks[this.mutable].start >= this.lineStart) {
			const type = this.blocks[this.mutable - 1].type;
			if (type !== 'code' && type !== 'heading' && type !== 'hr') this.mutable--;
		}
	}
}

function retainLine(before: MarkdownLine, after: MarkdownLine): MarkdownLine {
	if (before.kind !== after.kind || before.prefixes.length !== after.prefixes.length) return after;
	for (let index = 0; index < before.prefixes.length; index++) {
		const a = before.prefixes[index], b = after.prefixes[index];
		if (a.text !== b.text || a.first !== b.first || a.repeat !== b.repeat) return after;
	}
	if (before.kind === 'table') {
		const table = after as MarkdownTable; // Kinds match; parser-owned rows have the alignment count.
		if (before.alignments.length !== table.alignments.length || before.alignments.some((value, index) => value !== table.alignments[index])) return table;
		let changed = before.rows.length !== table.rows.length;
		for (let row = 0; row < before.rows.length && row < table.rows.length; row++) {
			let same = true;
			for (let column = 0; column < before.alignments.length; column++) {
				const cell = before.rows[row][column], revision = cell.revision;
				const next = table.rows[row][column] = retainLine(cell, table.rows[row][column]) as MarkdownTextLine;
				if (next !== cell || next.revision !== revision) same = false;
			}
			if (same) table.rows[row] = before.rows[row];
			else changed = true;
		}
		if (changed) { before.rows = table.rows; before.revision++; }
		return before;
	}
	const line = after as MarkdownTextLine;
	if (before.code !== line.code || before.spans.length !== line.spans.length) return line;
	for (let index = 0; index < before.spans.length; index++) {
		const a = before.spans[index], b = line.spans[index];
		if (a.style !== b.style) return line;
		if (index === before.spans.length - 1 ? !b.text.startsWith(a.text) : a.text !== b.text) return line;
	}
	if (before.spans.length && before.spans.at(-1)!.text !== line.spans.at(-1)!.text) { before.spans = line.spans; before.revision++; }
	return before;
}

function inlineSpans(tokens: readonly Token[], style: TextStyle = TextStyle.Plain, spans: StyledSpan[] = []): StyledSpan[] {
	for (const token of tokens) {
		switch (token.type) {
			case 'strong': inlineSpans(token.tokens, style | TextStyle.Bold, spans); break;
			case 'em': inlineSpans(token.tokens, style | TextStyle.Italic, spans); break;
			case 'del': inlineSpans(token.tokens, style | TextStyle.Strike, spans); break;
			case 'link':
				inlineSpans(token.tokens, style | TextStyle.Link, spans);
				// Keep destinations readable/copyable without granting navigation authority.
				if (token.href !== token.text) spans.push({ text: ` (${token.href})`, style: style | TextStyle.Link });
				break;
			case 'image': spans.push({ text: decodeHTMLStrict(token.text), style: style | TextStyle.Italic }); break;
			case 'codespan': spans.push({ text: token.text, style: style | TextStyle.Code }); break;
			case 'br': spans.push({ text: '\n', style }); break;
			case 'text':
				if (token.tokens) inlineSpans(token.tokens, style, spans);
				else spans.push({ text: decodeHTMLStrict(token.text), style });
				break;
			case 'escape': spans.push({ text: token.text, style }); break;
			default: spans.push({ text: token.raw, style }); break;
		}
	}
	return spans;
}

function blockLines(token: Token, lines: MarkdownLine[], prefixes: readonly MarkdownPrefix[]): void {
	const line = (spans: StyledSpan[], code = false) => lines.push({ kind: 'text', spans, prefixes, code, revision: 0 });
	switch (token.type) {
		case 'space': line([]); break;
		case 'heading': line(inlineSpans(token.tokens, TextStyle.Bold)); break;
		case 'paragraph': line(inlineSpans(token.tokens)); break;
		case 'text': line(inlineSpans([token])); break;
		case 'code':
			if (token.lang) line([{ text: token.lang, style: TextStyle.Italic }], true);
			// disable-next-line newline_normalization_pattern -- Marked's code token is already normalized; preserve each authored code line, including empty lines.
			for (const text of token.text.split('\n')) line([{ text, style: TextStyle.Code }], true);
			break;
		case 'blockquote': {
			const quote = [...prefixes, { text: '| ', first: true, repeat: true }];
			for (const item of token.tokens) blockLines(item, lines, quote);
			break;
		}
		case 'list':
			for (let index = 0; index < token.items.length; index++) {
				const item = token.items[index], first = lines.length;
				const text = item.task ? item.checked ? '[x] ' : '[ ] ' : token.ordered ? `${Number(token.start) + index}. ` : '- ';
				const indent = { text, first: false, repeat: false };
				const nested = [...prefixes, indent];
				for (const child of item.tokens) blockLines(child, lines, nested);
				// The first content line shows this item's marker. Every continuation,
				// paragraph and child block reserves the same measured hanging indent.
				if (lines.length === first) lines.push({ kind: 'text', spans: [], prefixes: nested, code: false, revision: 0 });
				lines[first].prefixes = lines[first].prefixes.map(prefix => prefix === indent ? { ...indent, first: true } : prefix);
			}
			break;
		case 'table':
			lines.push({ kind: 'table', prefixes, revision: 0, alignments: token.align,
				rows: [token.header, ...token.rows].map((cells, index) => cells.map(cell => ({ kind: 'text', code: false, prefixes: [], revision: 0,
					spans: inlineSpans(cell.tokens, index === 0 ? TextStyle.Bold : TextStyle.Plain) }))) });
			break;
		case 'hr': line([{ text: '--------', style: TextStyle.Plain }]); break;
		case 'def': break;
		default: line([{ text: token.raw, style: TextStyle.Plain }]); break;
	}
}
