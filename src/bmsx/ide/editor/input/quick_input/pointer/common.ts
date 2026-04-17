import { resourcePanel } from '../../../../workbench/contrib/resources/panel/controller';
import type { PointerSnapshot } from '../../../../common/models';
import { clearHoverTooltip, clearGotoHoverHighlight } from '../../../contrib/intellisense/engine';
import { resetBlink } from '../../../render/caret';
import { measureText } from '../../../common/text_layout';
import { editorPointerState } from '../../pointer/state';
import { editorCaretState } from '../../../ui/caret_state';

export function activateQuickInputField(): void {
	resourcePanel.setFocused(false);
	editorCaretState.cursorVisible = true;
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
