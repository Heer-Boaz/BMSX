import { resetBlink } from '../../render/caret';
import type { Clipboard } from '../../../../hosts/common/clipboard';
import type { PlayerInput } from '../../../../hosts/common/input/player';
import { point_in_rect, type RectBounds } from '../../../../machine/ts/common/rect';
import type { PointerSnapshot } from '../../../common/models';
import { consumeIdeKey, isCtrlDown, isMetaDown, isShiftDown, shouldRepeatKeyFromPlayer } from '../../../input/keyboard/key_input';
import { PointerButton } from '../../../input/pointer/buttons';
import { pointerCapture, type PointerCaptureTarget } from '../../../input/pointer/capture';
import { applyInlineFieldEditing, clearSelection, getCursorOffset, insertValue, moveCursor, setCursorFromOffset, setSelectionAnchorFromOffset } from './text_field';
import type { TextField } from './text_field_model';
import type { MultilineFieldViewport } from './multiline_viewport';

/** Editing and captured selection for a multiline field. The field owns focus and Undo. */
export class MultilineFieldControl implements PointerCaptureTarget {
	private input: { field: TextField; view: MultilineFieldViewport; bounds: RectBounds } | undefined;
	public rowHeight = 0;
	private verticalOffset = -1;
	private desiredX = 0;
	public setInput(field: TextField, view: MultilineFieldViewport, bounds: RectBounds): void { this.input = { field, view, bounds }; }
	public clearInput(): void { this.cancelPointer(); this.input?.field.focusTarget.release(); this.input = undefined; }
	public handleKeyboard(input: PlayerInput, clipboard: Clipboard): void {
		const { field, view } = this.input!;
		for (const code of ['ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter'] as const) {
			if ((code === 'Home' || code === 'End') && (isCtrlDown(input) || isMetaDown(input))) continue;
			if (!shouldRepeatKeyFromPlayer(code, input)) continue;
			consumeIdeKey(code, input);
			if (code === 'Enter') { insertValue(field, '\n'); this.verticalOffset = -1; }
			else {
				const row = view.rows[view.cursorRow];
				const cursor = getCursorOffset(field);
				if (isShiftDown(input)) {
					if (field.selectionAnchor === null) setSelectionAnchorFromOffset(field, cursor);
				} else clearSelection(field);
				if (code === 'Home' || code === 'End') {
					moveCursor(field, field.cursorRow, code === 'Home' ? 0 : field.lines[field.cursorRow].length, isShiftDown(input));
					this.verticalOffset = -1;
				} else {
					if (cursor !== this.verticalOffset) this.desiredX = row.advances[cursor - row.offset];
					setCursorFromOffset(field, view.offsetAt(view.cursorRow + (code === 'ArrowUp' ? -1 : 1), this.desiredX));
					this.verticalOffset = getCursorOffset(field);
				}
			}
			resetBlink(); return;
		}
		applyInlineFieldEditing(input, clipboard, field, { allowSpace: true });
		if (getCursorOffset(field) !== this.verticalOffset) this.verticalOffset = -1;
	}
	public handlePointer(snapshot: PointerSnapshot): boolean {
		const { field, view, bounds } = this.input!;
		if (!snapshot.valid || !snapshot.insideViewport || !point_in_rect(snapshot.viewportX, snapshot.viewportY, bounds)) return false;
		if ((snapshot.justPressedButtons & PointerButton.Primary) !== 0) {
			field.focusTarget.focus(); clearSelection(field); this.verticalOffset = -1;
			setCursorFromOffset(field, view.offsetAt(view.firstRow + Math.trunc((snapshot.viewportY - bounds.top - 2) / this.rowHeight), snapshot.viewportX - bounds.left - 3));
			setSelectionAnchorFromOffset(field, getCursorOffset(field));
			pointerCapture.capture(this); field.pointerSelecting = true; resetBlink();
		}
		return true;
	}
	public handleCapturedPointer(snapshot: PointerSnapshot): void {
		const { field, view, bounds } = this.input!;
		setCursorFromOffset(field, view.offsetAt(view.firstRow + Math.trunc((snapshot.viewportY - bounds.top - 2) / this.rowHeight), snapshot.viewportX - bounds.left - 3));
		resetBlink();
	}
	public releaseCapturedPointer(snapshot: PointerSnapshot): void { this.handleCapturedPointer(snapshot); this.cancelPointer(); }
	public cancelPointer(): void { pointerCapture.release(this); if (this.input) this.input.field.pointerSelecting = false; }
}
