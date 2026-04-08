import { ide_state } from '../../core/ide_state';
import type { PointerSnapshot } from '../../core/types';
import { clearHoverTooltip, clearGotoHoverHighlight } from '../../contrib/intellisense/intellisense';
import { resetBlink } from '../../render/render_caret';
import { measureText } from '../../core/text_utils';

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
