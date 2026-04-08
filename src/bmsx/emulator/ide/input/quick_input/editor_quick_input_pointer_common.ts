import { ide_state } from '../../ide_state';
import type { PointerSnapshot } from '../../types';
import { clearHoverTooltip, clearGotoHoverHighlight } from '../../intellisense';
import { resetBlink } from '../../render/render_caret';
import { measureText } from '../../text_utils';

export function activateQuickInputField(): void {
	ide_state.resourcePanelFocused = false;
	ide_state.cursorVisible = true;
	resetBlink();
}

export function finishQuickInputPointer(snapshot: PointerSnapshot): void {
	ide_state.pointerSelecting = false;
	ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
	clearHoverTooltip();
	clearGotoHoverHighlight();
}

export function quickInputTextLeft(label: string): number {
	return 4 + measureText(label + ' ');
}
