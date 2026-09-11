import { clamp } from '../../../../machine/ts/common/clamp';
import { create_rect_bounds, point_in_rect, write_rect_bounds } from '../../../../machine/ts/common/rect';
import { EDITOR_COMMAND_PRESENTATION } from '../../../commands/catalog';
import type { EditorCommandId } from '../../../common/commands';
import { SCROLLBAR_WIDTH } from '../../../common/constants';
import type { WorkbenchMenuItem } from '../../ui/menu/registry';
import { WorkbenchScrollViewport } from '../../ui/scroll_viewport';

export type ContextMenuRow = {
	readonly command: EditorCommandId | undefined;
	readonly label: string;
	enabled: boolean;
	top: number;
	bottom: number;
};

export const CONTEXT_MENU_PADDING = 6;

/** Retained command rows and geometry. No editor, document, token or graph identity. */
export class ContextMenuModel {
	public readonly bounds = create_rect_bounds();
	public readonly viewport = new WorkbenchScrollViewport();
	public readonly rows: ContextMenuRow[] = [];
	public selectedIndex = -1;
	public rowHeight = 0;
	private anchorX = 0;
	private anchorY = 0;
	private width = -1;
	private height = -1;
	private font: object | undefined;

	public setItems(items: readonly WorkbenchMenuItem[], x: number, y: number): void {
		this.rows.length = 0;
		for (const item of items) this.rows.push({
			command: item.type === 'command' ? item.command : undefined,
			label: item.type === 'command' ? EDITOR_COMMAND_PRESENTATION[item.command].title.toUpperCase() : '',
			enabled: false, top: 0, bottom: 0,
		});
		this.anchorX = x;
		this.anchorY = y;
		this.selectedIndex = -1;
		this.viewport.scrollbar.setScroll(0);
		this.font = undefined;
	}

	public layout(width: number, height: number, lineHeight: number, font: object, measure: (text: string) => number): void {
		if (this.width === width && this.height === height && this.rowHeight === lineHeight + 4 && this.font === font) return;
		this.width = width;
		this.height = height;
		this.font = font;
		this.rowHeight = lineHeight + 4;
		let contentHeight = 0;
		let contentWidth = 0;
		for (const row of this.rows) {
			row.top = contentHeight;
			contentHeight += row.command === undefined ? 5 : this.rowHeight;
			row.bottom = contentHeight;
			contentWidth = Math.max(contentWidth, measure(row.label));
		}
		const menuWidth = Math.min(width - 4, contentWidth + CONTEXT_MENU_PADDING * 2 + SCROLLBAR_WIDTH + 2);
		const menuHeight = Math.min(height - 4, contentHeight + 2);
		const left = clamp(this.anchorX, 2, width - menuWidth - 2);
		const top = clamp(this.anchorY, 2, height - menuHeight - 2);
		write_rect_bounds(this.bounds, left, top, left + menuWidth, top + menuHeight);
		this.viewport.layout(left + 1, top + 1, left + menuWidth - 1, top + menuHeight - 1, contentHeight);
		this.revealSelection();
	}

	public hitTest(x: number, y: number): number {
		if (!point_in_rect(x, y, this.viewport.bounds)) return -1;
		const top = y - this.viewport.offsetTop;
		for (let index = 0; index < this.rows.length; index += 1) {
			const row = this.rows[index];
			if (top >= row.top && top < row.bottom) return row.command === undefined ? -1 : index;
		}
		return -1;
	}

	public selectNext(direction: 1 | -1, start = this.selectedIndex): void {
		const count = this.rows.length;
		for (let step = 1; step <= count; step += 1) {
			const index = (start + direction * step + count) % count;
			if (this.rows[index].enabled) {
				this.selectedIndex = index;
				this.revealSelection();
				return;
			}
		}
		this.selectedIndex = -1;
	}

	public revealSelection(): void {
		if (this.selectedIndex < 0) return;
		const row = this.rows[this.selectedIndex];
		this.viewport.scrollbar.reveal(row.top, row.bottom, 0);
	}
}
