import { decodeHTMLStrict } from 'entities';
import { Lexer, type Token, type Tokens } from 'marked';

export const enum TextStyle { Plain = 0, Bold = 1, Italic = 2, Code = 4, Strike = 8, Link = 16 }
export type StyledSpan = { text: string; style: TextStyle };
export type MarkdownPrefix = { text: string; first: boolean; repeat: boolean };
export type MarkdownLine = { revision: number; spans: StyledSpan[]; prefixes: readonly MarkdownPrefix[]; code: boolean };
export type MarkdownBlock = { start: number; end: number; lines: MarkdownLine[]; plain: boolean; separated: boolean; revision: number };

/** Source-backed, inert Markdown. Raw HTML is text; destinations are never loaded or executed. */
export class MarkdownDocument {
	public constructor(private readonly format: 'markdown' | 'text' = 'markdown') {}
	public readonly blocks: MarkdownBlock[] = [];
	public source = '';
	private endedWithCR = false;
	private references = false;
	public append(raw: string): void {
		if (raw.length === 0) return;
		// disable-next-line newline_normalization_pattern -- CommonMark parser boundary, including CRLF split across streamed chunks; the source buffer is untouched.
		const text = (this.endedWithCR && raw.startsWith('\n') ? raw.slice(1) : raw).replace(/\r\n|\r/g, '\n');
		this.endedWithCR = raw.endsWith('\r');
		this.source += text;
		const last = this.blocks.at(-1);
		if (this.format === 'text') {
			if (last) {
				last.lines[0].spans[0].text += text; last.lines[0].revision++; last.end += text.length; last.revision++;
			} else this.blocks.push({ start: 0, end: text.length, plain: false, separated: false, revision: 0,
				lines: [{ spans: [{ text, style: TextStyle.Plain }], prefixes: [], code: false, revision: 0 }] });
			return;
		}
		// No Markdown delimiter, newline or punctuation can be introduced by this append.
		// Keep the plain paragraph and its wrapped prefix; a delimiter takes the parser path.
		if (last?.plain && last.end === this.source.length - text.length && /^[\p{L}\p{N}\p{M} \t]+$/u.test(text)) {
			last.lines[0].spans[0].text += text; last.lines[0].revision++; last.end += text.length; last.revision++; return;
		}
		const start = this.references ? 0 : last?.start ?? 0;
		let tokens = Lexer.lex(this.source.slice(start), { gfm: true });
		if (Object.keys(tokens.links).length > 0) {
			this.references = true;
			if (start !== 0) tokens = Lexer.lex(this.source, { gfm: true });
		}
		if (this.references) this.blocks.length = 0;
		else if (last) this.blocks.pop();
		let offset = this.references ? 0 : start;
		for (const token of tokens) {
			const lines: MarkdownLine[] = [];
			if (token.type !== 'space') blockLines(token, lines, []);
			if (lines.length > 0) {
				const plain = token.type === 'paragraph' && /^[\p{L}\p{N}\p{M} \t]+$/u.test(token.raw);
				// Retain unchanged parsed lines even inside an unfinished fenced block/list.
				// Later delimiters can change semantics; only equal styled prefixes survive.
				if (!this.references && last?.start === offset) {
					for (let index = 0; index < lines.length && index < last.lines.length; index++) lines[index] = retainLine(last.lines[index], lines[index]);
					last.lines = lines; last.end = offset + token.raw.length; last.plain = plain; last.revision++; this.blocks.push(last);
				} else this.blocks.push({ start: offset, end: offset + token.raw.length, lines, plain, separated: this.blocks.length > 0, revision: 0 });
			}
			offset += token.raw.length;
		}
	}
}

function retainLine(before: MarkdownLine, after: MarkdownLine): MarkdownLine {
	if (before.code !== after.code || before.prefixes.length !== after.prefixes.length
		|| before.spans.length !== after.spans.length || before.spans.length === 0) return after;
	for (let index = 0; index < before.prefixes.length; index++) {
		const a = before.prefixes[index], b = after.prefixes[index];
		if (a.text !== b.text || a.first !== b.first || a.repeat !== b.repeat) return after;
	}
	for (let index = 0; index < before.spans.length; index++) {
		const a = before.spans[index], b = after.spans[index];
		if (a.style !== b.style) return after;
		if (index === before.spans.length - 1 ? !b.text.startsWith(a.text) : a.text !== b.text) return after;
	}
	if (before.spans.at(-1)!.text !== after.spans.at(-1)!.text) { before.spans = after.spans; before.revision++; }
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
	const line = (spans: StyledSpan[], code = false) => lines.push({ spans, prefixes, code, revision: 0 });
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
				if (lines.length === first) lines.push({ spans: [], prefixes: nested, code: false, revision: 0 });
				lines[first].prefixes = lines[first].prefixes.map(prefix => prefix === indent ? { ...indent, first: true } : prefix);
			}
			break;
		case 'table': {
			const cellSpans = (cells: Tokens.TableCell[], style: TextStyle) => {
				const spans: StyledSpan[] = [];
				for (const cell of cells) {
					if (spans.length) spans.push({ text: ' | ', style: TextStyle.Plain });
					inlineSpans(cell.tokens, style, spans);
				}
				return spans;
			};
			line(cellSpans(token.header, TextStyle.Bold));
			for (const row of token.rows) line(cellSpans(row, TextStyle.Plain));
			break;
		}
		case 'hr': line([{ text: '--------', style: TextStyle.Plain }]); break;
		case 'def': break;
		default: line([{ text: token.raw, style: TextStyle.Plain }]); break;
	}
}
