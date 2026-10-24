import { clamp } from '../../../../machine/ts/common/clamp';
import type { RectBounds } from '../../../../machine/ts/common/rect';
import { ScratchBuffer } from '../../../../machine/ts/common/scratchbuffer';
import { SCROLLBAR_WIDTH } from '../../../common/constants';
import { CaseFoldedText } from '../../../common/search_text';
import { changedTextRange } from '../../../common/text';
import { mapTextOffset } from '../../../editor/text/text_change';
import type { TextBuffer } from '../../../editor/text/text_buffer';
import type { EditorFont } from '../../../editor/ui/view/font';
import { WorkbenchScrollViewport } from '../scroll_viewport';
import { TEXT_VIEW_PADDING, WorkbenchTextViewLayout } from './layout';

export type WorkbenchTextViewMove = 'left' | 'right' | 'up' | 'down' | 'home' | 'end'
	| 'pageUp' | 'pageDown' | 'documentStart' | 'documentEnd';
export type WorkbenchTextViewMatch = { start: number; end: number };

/** Read-only document state. Neither document identity nor edit/history semantics are invented here. */
export class WorkbenchTextViewModel {
	public readonly viewport = new WorkbenchScrollViewport();
	public readonly projection = new WorkbenchTextViewLayout();
	public readonly matches: WorkbenchTextViewMatch[] = [];
	public cursorOffset = 0;
	public rowHeight = 0;
	private anchor = 0;
	private bufferValue: TextBuffer;
	private bufferVersion: number;
	private text: string;
	private folded: CaseFoldedText | undefined;
	private queryValue = '';
	private matchIndexValue = -1;
	private readonly matchSlots = new ScratchBuffer<WorkbenchTextViewMatch>(() => ({ start: 0, end: 0 }));
	private readingOffset = 0;
	private readingBias = 0;
	private readingFraction = 0;
	private readingEdge: 'start' | 'end' | undefined = 'start';
	private projectedScroll: number | undefined;
	private desiredX: number | undefined;
	private revealOffset: number | undefined;
	private readonly bufferListeners = new Set<() => void>();

	public constructor(buffer: TextBuffer) {
		this.bufferValue = buffer; this.bufferVersion = buffer.version; this.text = buffer.getText();
		this.projection.setText(this.text);
	}
	public get buffer(): TextBuffer { return this.bufferValue; }
	public get selectionAnchor(): number { return this.anchor; }
	public get selectionStart(): number { return Math.min(this.anchor, this.cursorOffset); }
	public get selectionEnd(): number { return Math.max(this.anchor, this.cursorOffset); }
	public get query(): string { return this.queryValue; }
	public get matchCount(): number { return this.matches.length; }
	public get matchIndex(): number { return this.matchIndexValue; }
	public onWillChangeBuffer(listener: () => void): () => void {
		this.bufferListeners.add(listener);
		return () => this.bufferListeners.delete(listener);
	}

	/** Explicit source publication maps retained source positions once; clean presentation never reads the document again. */
	public setBuffer(buffer: TextBuffer): void {
		if (buffer === this.bufferValue && buffer.version === this.bufferVersion) return;
		const text = buffer.getText(), range = changedTextRange(this.text, text);
		if (range !== undefined) for (const listener of this.bufferListeners) listener();
		this.captureReading();
		this.bufferValue = buffer; this.bufferVersion = buffer.version;
		if (range === undefined) return;
		const changes = [{ offset: range.start, deletedLength: range.previousEnd - range.start, insertedLength: range.nextEnd - range.start }];
		this.anchor = mapTextOffset(this.anchor, changes, 1);
		this.cursorOffset = mapTextOffset(this.cursorOffset, changes, 1);
		this.readingOffset = mapTextOffset(this.readingOffset, changes, 1);
		if (this.revealOffset !== undefined) this.revealOffset = mapTextOffset(this.revealOffset, changes, 1);
		this.text = text; this.folded = undefined; this.desiredX = undefined;
		this.projection.setText(text); this.updateMatches();
	}

	public layout(bounds: Readonly<RectBounds>, font: EditorFont, lineHeight: number): void {
		this.captureReading();
		const width = bounds.right - bounds.left - SCROLLBAR_WIDTH - TEXT_VIEW_PADDING * 2;
		if (width > 0) this.projection.update(font, width);
		this.rowHeight = lineHeight;
		this.viewport.layout(bounds.left, bounds.top, bounds.right, bounds.bottom,
			this.projection.rows.length * lineHeight + TEXT_VIEW_PADDING * 2);
		if (this.projection.rows.length !== 0) {
			let top = 0;
			if (this.readingEdge === 'end') top = this.viewport.contentHeight - this.viewport.height;
			else if (this.readingEdge === undefined) top = TEXT_VIEW_PADDING
				+ (this.projection.rowAtOffset(this.readingOffset, this.readingBias) + this.readingFraction) * lineHeight;
			this.viewport.scrollbar.setScroll(top); this.projectedScroll = this.viewport.scrollTop;
			if (this.revealOffset !== undefined && this.viewport.height > 0) this.reveal(this.revealOffset);
		}
	}

	/** The scrolling control distinguishes absolute edge commands from relative user intent. */
	public noteUserScroll(edge?: 'start' | 'end'): void {
		this.readingEdge = edge; this.projectedScroll = undefined; this.revealOffset = undefined;
		if (edge !== undefined) { this.readingOffset = 0; this.readingBias = 0; this.readingFraction = 0; }
	}

	private captureReading(): void {
		const view = this.viewport, rows = this.projection.rows;
		if (this.readingEdge !== undefined || this.rowHeight === 0 || rows.length === 0 || this.projectedScroll === view.scrollTop) return;
		if (view.height === 0 && this.projectedScroll !== undefined) return;
		const top = view.scrollTop;
		if (view.contentHeight > view.height && top + view.height >= view.contentHeight) {
			this.readingEdge = 'end'; this.projectedScroll = top; return;
		}
		const index = clamp(Math.trunc((top - TEXT_VIEW_PADDING) / this.rowHeight), 0, rows.length - 1), row = rows[index];
		this.readingOffset = row.sourceStart; this.readingBias = row.bias;
		this.readingFraction = (top - TEXT_VIEW_PADDING - index * this.rowHeight) / this.rowHeight;
		this.projectedScroll = top;
	}

	public select(anchor: number, cursor: number): void {
		this.anchor = clamp(anchor, 0, this.buffer.length); this.cursorOffset = clamp(cursor, 0, this.buffer.length);
		this.desiredX = undefined; this.matchIndexValue = -1;
	}
	public selectAll(): void { this.select(0, this.buffer.length); this.reveal(this.cursorOffset); }
	public copy(): string | null {
		return this.selectionStart === this.selectionEnd ? null : this.buffer.getTextRange(this.selectionStart, this.selectionEnd);
	}

	public offsetAt(x: number, y: number): number {
		const row = Math.trunc((y - this.viewport.offsetTop - TEXT_VIEW_PADDING) / this.rowHeight);
		return this.projection.offsetAt(row, x - this.viewport.bounds.left - TEXT_VIEW_PADDING);
	}

	public move(kind: WorkbenchTextViewMove, extend = false): void {
		const cursor = this.cursorOffset, rows = this.projection.rows;
		let next = cursor;
		const vertical = kind === 'up' || kind === 'down' || kind === 'pageUp' || kind === 'pageDown';
		if (!extend && this.selectionStart !== this.selectionEnd && (kind === 'left' || kind === 'right'))
			next = kind === 'left' ? this.selectionStart : this.selectionEnd;
		else if (kind === 'left' && cursor > 0)
			next = cursor - (cursor > 1 && (this.text.codePointAt(cursor - 2)! > 0xffff
				|| this.text.charCodeAt(cursor - 2) === 13 && this.text.charCodeAt(cursor - 1) === 10) ? 2 : 1);
		else if (kind === 'right' && cursor < this.text.length) next = cursor + (this.text.codePointAt(cursor)! > 0xffff
			|| this.text.charCodeAt(cursor) === 13 && this.text.charCodeAt(cursor + 1) === 10 ? 2 : 1);
		else if (kind === 'documentStart') next = 0;
		else if (kind === 'documentEnd') next = this.text.length;
		else if (kind === 'home') next = this.projection.lineAt(cursor).start;
		else if (kind === 'end') next = this.projection.lineAt(cursor).end;
		else if (vertical) {
			const rowIndex = this.projection.rowAtOffset(cursor), row = rows[rowIndex];
			if (this.desiredX === undefined) this.desiredX = row.line.advances[this.projection.displayAt(row.line, cursor)] - row.line.advances[row.start];
			const step = kind === 'up' || kind === 'down' ? 1 : Math.max(1, Math.trunc(this.viewport.height / this.rowHeight));
			next = this.projection.offsetAt(rowIndex + (kind === 'up' || kind === 'pageUp' ? -step : step), this.desiredX);
		}
		if (!extend) this.anchor = next;
		this.cursorOffset = next; this.matchIndexValue = -1;
		if (!vertical) this.desiredX = undefined;
		this.reveal(next);
	}

	private reveal(offset: number): void {
		this.revealOffset = offset;
		if (this.rowHeight === 0 || this.viewport.height === 0 || this.projection.rows.length === 0) return;
		const top = TEXT_VIEW_PADDING + this.projection.rowAtOffset(offset) * this.rowHeight;
		this.viewport.scrollbar.reveal(top, top + this.rowHeight, 0);
		this.revealOffset = undefined; this.readingEdge = undefined; this.projectedScroll = undefined;
		this.captureReading();
	}

	public setQuery(query: string): void {
		if (query === this.queryValue) return;
		this.queryValue = query; this.updateMatches();
	}
	private updateMatches(): void {
		this.matches.length = 0; this.matchIndexValue = -1;
		if (this.queryValue.length === 0) return;
		this.folded ??= new CaseFoldedText(this.text);
		const needle = this.queryValue.toLowerCase(), folded = this.folded;
		let from = 0;
		while (from <= folded.lower.length - needle.length) {
			const found = folded.lower.indexOf(needle, from);
			if (found === -1) break;
			const match = this.matchSlots.get(this.matches.length);
			match.start = folded.sourceStart(found); match.end = folded.sourceEnd(found + needle.length);
			this.matches.push(match); from = found + needle.length;
		}
	}
	public firstMatchAt(offset: number): number {
		let low = 0, high = this.matches.length;
		while (low < high) {
			const middle = (low + high) >>> 1;
			if (this.matches[middle].end <= offset) low = middle + 1; else high = middle;
		}
		return low;
	}
	public nextMatch(direction: -1 | 1): boolean {
		if (this.matches.length === 0) return false;
		let index = this.matchIndexValue;
		if (index < 0) {
			index = this.firstMatchAt(this.cursorOffset);
			if (direction < 0) index--;
		} else index += direction;
		index = (index + this.matches.length) % this.matches.length;
		const match = this.matches[index];
		this.select(match.start, match.end); this.matchIndexValue = index; this.reveal(match.end);
		return true;
	}
}
