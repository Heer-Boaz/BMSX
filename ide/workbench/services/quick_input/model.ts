import { point_in_rect } from '../../../../machine/ts/common/rect';
import { WorkbenchScrollViewport } from '../../ui/scroll_viewport';
import type { QuickPickItem, QuickPickMatch, QuickPickProvider } from './provider';

export type QuickPickRenderRow = {
	readonly item: QuickPickItem;
	textRevision: number;
	labelText: string;
	descriptionText: string;
	detailText: string;
};

const EMPTY_ITEMS: readonly QuickPickItem[] = [];
const EMPTY_MATCHES: readonly QuickPickMatch[] = [];

/** Provider results are consumed directly; only presented items acquire render data. */
export class QuickPickModel {
	public items = EMPTY_ITEMS;
	public readonly viewport = new WorkbenchScrollViewport();
	public rowHeight = 0;
	public revision = 0;
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
		this.renderRows.clear();
		this.list.selectionIndex = -1;
		this.list.hoverIndex = -1;
		this.viewport.scrollbar.setScroll(0);
	}

	public filter(value: string): void {
		const projection = this.input!.getPicks(value);
		const list = this.list;
		list.rows = projection.matches;
		list.selectionIndex = projection.selectionIndex;
		this.viewport.scrollbar.setScroll(0);
		list.hoverIndex = -1;
		this.revision += 1;
	}

	public getRenderRow(match: QuickPickMatch): QuickPickRenderRow {
		let row = this.renderRows.get(match.itemIndex);
		if (row === undefined) {
			row = { item: match.item, textRevision: -1, labelText: '', descriptionText: '', detailText: '' };
			this.renderRows.set(match.itemIndex, row);
		}
		return row;
	}
}
