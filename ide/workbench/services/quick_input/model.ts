import type { WorkbenchListState } from '../../ui/list_view';

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
	labelText: string;
	descriptionText: string;
	detailText: string;
};

/** One row allocation per admitted item, not per filter or rendered frame. */
export class QuickPickModel {
	public readonly entries: QuickPickRow[] = [];
	public readonly list: WorkbenchListState<QuickPickRow> = {
		rows: [], selectionIndex: -1, scroll: 0, hoverIndex: -1,
		layout: { contentLeft: 0, contentTop: 0, contentRight: 0, contentBottom: 0, rowHeight: 0, visibleRowCount: 0 },
	};

	public setItems(items: readonly QuickPickItem[]): void {
		this.entries.length = 0;
		for (let index = 0; index < items.length; index += 1) {
			const item = items[index];
			this.entries.push({ item, itemIndex: index,
				searchKey: `${item.label} ${item.description} ${item.detail}`.toLowerCase(),
				matchIndex: 0, labelText: '', descriptionText: '', detailText: '' });
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
		list.scroll = 0;
		list.hoverIndex = -1;
	}
}

function compareMatches(left: QuickPickRow, right: QuickPickRow): number {
	return left.matchIndex - right.matchIndex || left.item.label.length - right.item.label.length
		|| left.item.label.localeCompare(right.item.label) || left.itemIndex - right.itemIndex;
}
