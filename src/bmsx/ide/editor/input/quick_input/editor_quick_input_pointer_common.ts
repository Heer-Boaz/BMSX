import { resourcePanel } from '../../../workbench/contrib/resources/resource_panel_controller';
import type { PointerSnapshot } from '../../../common/types';
import { clearHoverTooltip, clearGotoHoverHighlight } from '../../contrib/intellisense/intellisense';
import { resetBlink } from '../../render/render_caret';
import { measureText } from '../../common/text_layout';
import { editorPointerState } from '../pointer/editor_pointer_state';
import { editorCaretState } from '../../ui/caret_state';

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
