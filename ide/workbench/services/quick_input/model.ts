import { point_in_rect } from '../../../../machine/ts/common/rect';
import { WorkbenchScrollViewport } from '../../ui/scroll_viewport';

/** Display data only. The caller retains the actual resource/symbol/other item. */
export type QuickPickItem = {
	readonly label: string;
	readonly description: string;
	readonly detail: string;
};

export type QuickPickRow = {
	readonly item: QuickPickItem;
	readonly itemIndex: number;
	readonly searchKey: string;
	matchIndex: number;
	textRevision: number;
	labelText: string;
	descriptionText: string;
	detailText: string;
};

/** One row allocation per admitted item, not per filter or rendered frame. */
export class QuickPickModel {
	public readonly entries: QuickPickRow[] = [];
	public readonly viewport = new WorkbenchScrollViewport();
	public rowHeight = 0;
	public revision = 0;
	public readonly list = {
		rows: [] as QuickPickRow[], selectionIndex: -1, hoverIndex: -1,
	};

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

	public setItems(items: readonly QuickPickItem[]): void {
		this.entries.length = 0;
		for (let index = 0; index < items.length; index += 1) {
			const item = items[index];
			this.entries.push({ item, itemIndex: index,
				searchKey: `${item.label} ${item.description} ${item.detail}`.toLowerCase(),
				matchIndex: 0, textRevision: -1, labelText: '', descriptionText: '', detailText: '' });
		}
	}

	public filter(value: string): void {
		const query = value.trim().toLowerCase();
		const tokens = query.length === 0 ? [] : query.split(/\s+/);
		const list = this.list;
		list.rows.length = 0;
		for (const row of this.entries) {
			let score = row.searchKey.length;
			for (const token of tokens) {
				const index = row.searchKey.indexOf(token);
				if (index === -1) { score = -1; break; }
				if (index < score) score = index;
			}
			if (score !== -1) {
				row.matchIndex = score;
				list.rows.push(row);
			}
		}
		if (tokens.length > 0) list.rows.sort(compareMatches);
		list.selectionIndex = list.rows.length === 0 ? -1 : 0;
		this.viewport.scrollbar.setScroll(0);
		list.hoverIndex = -1;
		this.revision += 1;
	}
}

function compareMatches(left: QuickPickRow, right: QuickPickRow): number {
	return left.matchIndex - right.matchIndex || left.item.label.length - right.item.label.length
		|| left.item.label.localeCompare(right.item.label) || left.itemIndex - right.itemIndex;
}
