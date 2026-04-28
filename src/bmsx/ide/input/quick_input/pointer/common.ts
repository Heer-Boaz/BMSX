import type { PointerSnapshot } from '../../../common/models';
import { clearHoverTooltip, clearGotoHoverHighlight } from '../../../editor/contrib/intellisense/engine';
import { resetBlink } from '../../../editor/render/caret';
import { measureText } from '../../../editor/common/text/layout';
import { editorPointerState } from '../../pointer/state';
import { editorCaretState } from '../../../editor/ui/view/caret/state';
import type { ResourcePanelController } from '../../../workbench/contrib/resources/panel/controller';

export function activateQuickInputField(resourcePanel: ResourcePanelController): void {
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
