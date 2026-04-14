import { ide_state } from '../../core/ide_state';
import type { PointerSnapshot } from '../../core/types';
import { clearHoverTooltip, clearGotoHoverHighlight } from '../../contrib/intellisense/intellisense';
import { resetBlink } from '../../render/render_caret';
import { measureText } from '../../core/text_utils';
import { editorPointerState } from '../pointer/editor_pointer_state';

export function activateQuickInputField(): void {
	ide_state.resourcePanel.setFocused(false);
	ide_state.cursorVisible = true;
	resetBlink();
}

export function finishQuickInputPointer(snapshot: PointerSnapshot): void {
	editorPointerState.pointerSelecting = false;
	editorPointerState.pointerPrimaryWasPressed = snapshot.primaryPressed;
	clearHoverTooltip();
	clearGotoHoverHighlight();
}

export function quickInputTextLeft(label: string): number {
	return 4 + measureText(label + ' ');
}
