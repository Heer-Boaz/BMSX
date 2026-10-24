import { resetBlink } from '../../../editor/render/caret';
import { editorCaretState } from '../../../editor/ui/view/caret/state';
import type { ResourcePanelController } from '../../../workbench/contrib/resources/panel/controller';

export function activateQuickInputField(resourcePanel: ResourcePanelController): void {
	resourcePanel.setFocused(false);
	editorCaretState.cursorVisible = true;
	resetBlink();
}
