import { create_rect_bounds, point_in_rect, write_rect_bounds, type RectBounds } from '../../../machine/ts/common/rect';
import type { PlayerInput } from '../../../hosts/common/input/player';
import type { PointerSnapshot } from '../../common/models';
import * as colors from '../../common/constants';
import { consumeIdeKey, isKeyJustPressed, shouldRepeatKeyFromPlayer } from '../../input/keyboard/key_input';
import { PointerButton } from '../../input/pointer/buttons';
import { pointerCapture, type PointerCaptureTarget } from '../../input/pointer/capture';
import { pointerHover } from '../../input/pointer/hover';
import { editorViewState } from '../../editor/ui/view/state';
import { advanceQuickInputSelection } from '../../editor/navigation/quick_input_navigation';
import { api } from '../../runtime/overlay_api';
import { QuickPickModel } from '../services/quick_input/model';
import type { QuickPickItem, QuickPickProvider } from '../services/quick_input/provider';
import { drawQuickPickRows, layoutQuickPickRows, type QuickPickRows } from '../services/quick_input/list_render';
import { ScrollbarPointerControl } from './scrollbar_pointer';

const NAVIGATION_KEYS = ['ArrowUp', 'ArrowDown'] as const;
const ACCEPT_KEYS = ['Enter', 'NumpadEnter', 'Tab'] as const;

/** Suggestions borrow their text/query from the focused field, not another input box. */
export class InlineSuggestions<T extends QuickPickItem> implements PointerCaptureTarget {
	public readonly model = new QuickPickModel();
	public readonly bounds = create_rect_bounds();
	public visible = false;
	private provider: QuickPickProvider<T>;
	private readonly rows: QuickPickRows = { preparedStart: -1, preparedEnd: -1, textRevision: 0, renderRows: [] };
	private font: object | undefined;
	private revision = -1;
	private readonly scrollbarPointer = new ScrollbarPointerControl(pointerCapture);
	private pressedItem: T | undefined;
	private pointerRevision = -1;
	public constructor(private readonly accept: (item: T) => void) {}
	public open(provider: QuickPickProvider<T>): void {
		this.provider = provider; this.model.setInput(provider); this.visible = true;
		this.scrollbarPointer.setInput(this.model.viewport.scrollbar);
	}
	public hide(): void {
		if (!this.visible) return;
		this.visible = false; this.cancelPointer(); pointerHover.release(this); this.scrollbarPointer.clearInput();
		this.model.clearInput(); this.rows.renderRows.length = 0;
	}
	public update(anchor: RectBounds, topLimit: number): void {
		if (!this.visible) return;
		const rowHeight = editorViewState.lineHeight * 2 + 2;
		const available = Math.max(1, Math.trunc((anchor.top - topLimit - 4) / rowHeight));
		const height = Math.min(6, available, Math.max(1, this.model.list.rows.length)) * rowHeight;
		const top = anchor.top - height - 4;
		const textChanged = this.bounds.right - this.bounds.left !== anchor.right - anchor.left || this.font !== editorViewState.font;
		const changed = textChanged || this.bounds.left !== anchor.left || this.bounds.top !== top
			|| this.bounds.bottom !== anchor.top - 2 || this.revision !== this.model.revision;
		if (changed) {
			write_rect_bounds(this.bounds, anchor.left, top, anchor.right, anchor.top - 2);
			this.font = editorViewState.font; this.revision = this.model.revision;
			if (textChanged) this.rows.textRevision++;
			this.model.rowHeight = rowHeight;
			this.model.viewport.layout(anchor.left + 1, top + 1, anchor.right - 1, top + 1 + height, this.model.list.rows.length * rowHeight);
			this.model.revealSelection();
		}
		layoutQuickPickRows(this.model, this.rows, changed);
		this.scrollbarPointer.update();
		if (this.pressedItem !== undefined && this.pointerRevision !== this.model.viewport.revision) this.cancelPointer();
	}
	public draw(): void {
		if (!this.visible) return;
		const b = this.bounds;
		api.fill_rect(b.left, b.top, b.right, b.bottom, 0, colors.COLOR_QUICK_OPEN_BACKGROUND);
		api.blit_rect(b.left, b.top, b.right, b.bottom, 0, colors.COLOR_QUICK_OPEN_OUTLINE);
		drawQuickPickRows(this.model, this.rows);
	}
	public handleKeyboard(input: PlayerInput): boolean {
		if (!this.visible) return false;
		if (isKeyJustPressed('Escape', input)) { consumeIdeKey('Escape', input); this.hide(); return true; }
		for (const key of NAVIGATION_KEYS) if (shouldRepeatKeyFromPlayer(key, input)) {
			consumeIdeKey(key, input);
			this.model.list.selectionIndex = advanceQuickInputSelection(this.model.list.selectionIndex, this.model.list.rows.length, key === 'ArrowDown' ? 1 : -1);
			this.model.revealSelection(); return true;
		}
		for (const key of ACCEPT_KEYS) if (isKeyJustPressed(key, input)) {
			consumeIdeKey(key, input); this.acceptSelection(); return true;
		}
		return false;
	}
	public handlePointer(pointer: PointerSnapshot): boolean {
		if (!this.visible || !pointer.insideViewport) return false;
		if (this.scrollbarPointer.handlePointer(pointer)) return true;
		const inside = point_in_rect(pointer.viewportX, pointer.viewportY, this.bounds);
		this.handleCapturedPointer(pointer);
		if ((pointer.justPressedButtons & PointerButton.Primary) !== 0) {
			if (!inside) { this.hide(); return false; }
			const index = this.model.list.hoverIndex;
			if (index >= 0) {
				this.model.list.selectionIndex = index;
				this.pressedItem = this.provider.items[this.model.list.rows[index].itemIndex];
				this.pointerRevision = this.model.viewport.revision;
				pointerCapture.capture(this, PointerButton.Primary);
				if ((pointer.justReleasedButtons & PointerButton.Primary) !== 0) this.releaseCapturedPointer(pointer);
			}
		}
		return inside;
	}
	public handleCapturedPointer(pointer: PointerSnapshot): void {
		this.model.list.hoverIndex = this.model.rowIndexAtPosition(pointer.viewportX, pointer.viewportY);
		if (this.model.list.hoverIndex >= 0) pointerHover.visit(this); else pointerHover.release(this);
	}
	public releaseCapturedPointer(pointer: PointerSnapshot): void {
		const item = this.pressedItem, index = this.model.rowIndexAtPosition(pointer.viewportX, pointer.viewportY);
		this.cancelPointer();
		if (index >= 0 && this.provider.items[this.model.list.rows[index].itemIndex] === item) this.accept(item!);
	}
	public cancelPointer(): void { pointerCapture.release(this); this.pressedItem = undefined; }
	public onPointerLeave(): void { this.model.list.hoverIndex = -1; }
	public handleWheel(pointer: PointerSnapshot, delta: number): boolean {
		if (!this.visible || !point_in_rect(pointer.viewportX, pointer.viewportY, this.bounds)) return false;
		this.cancelPointer(); this.scrollbarPointer.cancelPointer();
		this.model.viewport.scrollbar.setScroll(this.model.viewport.scrollTop + delta * this.model.rowHeight); return true;
	}
	public acceptSelection(): void {
		const match = this.model.list.rows[this.model.list.selectionIndex];
		if (match) this.accept(this.provider.items[match.itemIndex]);
	}
}
