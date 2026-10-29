import { clamp } from '../../../../machine/ts/common/clamp';
import { create_rect_bounds, point_in_rect, write_rect_bounds, type RectBounds } from '../../../../machine/ts/common/rect';
import { editorCommandTitle } from '../../../commands/catalog';
import { EDITOR_COMMAND_KEYBINDING_LABELS } from '../../../input/keyboard/command_keybindings';
import type { EditorCommandId } from '../../../common/commands';
import { SCROLLBAR_WIDTH } from '../../../common/constants';
import type { WorkbenchMenuItem } from '../../ui/menu/registry';
import { WorkbenchScrollViewport } from '../../ui/scroll_viewport';

export type ContextMenuPlacement = 'point' | 'below';

export type ContextMenuRow = {
	readonly command: EditorCommandId | undefined;
	label: string;
	readonly keybinding: string | undefined;
	keybindingWidth: number;
	active: boolean;
	labelWidth: number;
	font: object | undefined;
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
	private placement: ContextMenuPlacement = 'point';
	private width = -1;
	private height = -1;
	private left = 0;
	private top = 0;
	private font: object | undefined;

	public setItems(items: readonly WorkbenchMenuItem[], x: number, y: number, shortTitles = false, placement: ContextMenuPlacement = 'point'): void {
		this.rows.length = 0;
		for (const item of items) this.rows.push({
			command: item.type === 'command' ? item.command : undefined,
			label: item.type === 'command' ? editorCommandTitle(item.command, false, shortTitles).toUpperCase() : '',
			keybinding: item.type === 'command' ? EDITOR_COMMAND_KEYBINDING_LABELS.get(item.command) : undefined,
			keybindingWidth: 0, labelWidth: 0, active: false, font: undefined,
			enabled: false, top: 0, bottom: 0,
		});
		this.anchorX = x;
		this.anchorY = y;
		this.placement = placement;
		this.selectedIndex = -1;
		this.viewport.scrollbar.setScroll(0);
		this.font = undefined;
	}

	public setLabel(row: ContextMenuRow, label: string): void {
		if (row.label === label) return;
		row.label = label;
		row.font = undefined;
		this.font = undefined;
	}

	public layout(area: Readonly<RectBounds>, lineHeight: number, font: object, measure: (text: string) => number): void {
		const width = area.right - area.left, height = area.bottom - area.top;
		if (this.width === width && this.height === height && this.left === area.left && this.top === area.top
			&& this.rowHeight === lineHeight + 4 && this.font === font) return;
		this.width = width;
		this.height = height;
		this.left = area.left; this.top = area.top;
		this.font = font;
		this.rowHeight = lineHeight + 4;
		let contentHeight = 0;
		let contentWidth = 0;
		for (const row of this.rows) {
			row.top = contentHeight;
			contentHeight += row.command === undefined ? 5 : this.rowHeight;
			row.bottom = contentHeight;
			if (row.font !== font) {
				row.labelWidth = measure(row.label);
				row.keybindingWidth = row.keybinding === undefined ? 0 : measure(row.keybinding);
				row.font = font;
			}
			contentWidth = Math.max(contentWidth, row.labelWidth + (row.keybinding === undefined ? 0 : CONTEXT_MENU_PADDING * 2 + row.keybindingWidth));
		}
		const menuWidth = Math.min(width - 4, contentWidth + CONTEXT_MENU_PADDING * 3 + Math.max(lineHeight >> 1, 2) + SCROLLBAR_WIDTH + 2);
		const availableHeight = this.placement === 'below' ? Math.min(height - 4, area.bottom - this.anchorY - 2) : height - 4;
		const menuHeight = Math.min(availableHeight, contentHeight + 2);
		const left = clamp(this.anchorX, area.left + 2, area.right - menuWidth - 2);
		const top = clamp(this.anchorY, area.top + 2, area.bottom - menuHeight - 2);
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
