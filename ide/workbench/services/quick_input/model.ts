import { point_in_rect } from '../../../../machine/ts/common/rect';
import { ScratchBuffer } from '../../../../machine/ts/common/scratchbuffer';
import { HighlightedLabel } from '../../../editor/ui/highlighted_label';
import { WorkbenchScrollViewport } from '../../ui/scroll_viewport';
import type { QuickPickHighlight, QuickPickItem, QuickPickMatch, QuickPickProvider } from './provider';

export type QuickPickRenderRow = {
	readonly item: QuickPickItem;
	textRevision: number;
	highlightRevision: number;
	readonly label: HighlightedLabel;
	readonly description: HighlightedLabel;
	readonly detail: HighlightedLabel;
};

const EMPTY_ITEMS: readonly QuickPickItem[] = [];
const EMPTY_MATCHES: readonly QuickPickMatch[] = [];
const EMPTY_HIGHLIGHTS = new ScratchBuffer<QuickPickHighlight>(() => ({ field: 'label', start: 0, end: 0 }));

/** Provider results are consumed directly; only presented items acquire render data. */
export class QuickPickModel {
	public items = EMPTY_ITEMS;
	public readonly viewport = new WorkbenchScrollViewport();
	public rowHeight = 0;
	public revision = 0;
	public highlights = EMPTY_HIGHLIGHTS;
	public readonly list = {
		rows: EMPTY_MATCHES, selectionIndex: -1, hoverIndex: -1,
	};
	private input: QuickPickProvider | undefined;
	private readonly renderRows = new Map<number, QuickPickRenderRow>();

	public get visibleRowCount(): number { return Math.trunc(this.viewport.height / this.rowHeight); }
	public get firstVisibleIndex(): number { return Math.trunc((this.viewport.bounds.top - this.viewport.offsetTop) / this.rowHeight); }
	public get endVisibleIndex(): number {
		return Math.min(this.list.rows.length, Math.trunc((this.viewport.bounds.bottom - this.viewport.offsetTop + this.rowHeight - 1) / this.rowHeight));
	}

	public rowTop(index: number): number { return this.viewport.offsetTop + index * this.rowHeight; }

	public rowIndexAtPosition(x: number, y: number): number {
		if (!point_in_rect(x, y, this.viewport.bounds)) return -1;
		const index = Math.trunc((y - this.viewport.offsetTop) / this.rowHeight);
		return index < this.list.rows.length ? index : -1;
	}

	public revealSelection(): void {
		if (this.list.selectionIndex < 0) return;
		const top = this.list.selectionIndex * this.rowHeight;
		this.viewport.scrollbar.reveal(top, top + this.rowHeight);
	}

	public setInput(input: QuickPickProvider): void {
		this.clearInput();
		this.input = input;
		this.items = input.items;
	}

	public clearInput(): void {
		this.input = undefined;
		this.items = EMPTY_ITEMS;
		this.list.rows = EMPTY_MATCHES;
		this.highlights = EMPTY_HIGHLIGHTS;
		this.renderRows.clear();
		this.list.selectionIndex = -1;
		this.list.hoverIndex = -1;
		this.viewport.scrollbar.setScroll(0);
	}

	public filter(value: string): void {
		const projection = this.input!.getPicks(value);
		const list = this.list;
		list.rows = projection.matches;
		this.highlights = projection.highlights;
		list.selectionIndex = projection.selectionIndex;
		this.viewport.scrollbar.setScroll(0);
		list.hoverIndex = -1;
		this.revision += 1;
	}

	public getRenderRow(match: QuickPickMatch): QuickPickRenderRow {
		let row = this.renderRows.get(match.itemIndex);
		if (row === undefined) {
			row = { item: match.item, textRevision: -1, highlightRevision: -1,
				label: new HighlightedLabel(), description: new HighlightedLabel(), detail: new HighlightedLabel() };
			this.renderRows.set(match.itemIndex, row);
		}
		return row;
	}
}
