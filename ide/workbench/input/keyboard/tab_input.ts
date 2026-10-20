import type { KeyInputEvent } from '../../../../hosts/common/input/text';
import { consumeIdeKey, isCtrlDown, isKeyJustPressed, isMetaDown, isShiftDown } from '../../../input/keyboard/key_input';
import type { EditorPanes } from '../../services/editor/editor_panes';
import { closeActiveTab, cycleTab } from '../../ui/tabs';

/** Workbench tab commands remain available independently of the active view. */
export function handleWorkbenchTabInput(
	playerInput: KeyInputEvent,
	editorPanes: EditorPanes,
): boolean {
	if (!(isCtrlDown(playerInput) || isMetaDown(playerInput))) {
		return false;
	}
	if (isKeyJustPressed('KeyW', playerInput)) {
		consumeIdeKey('KeyW', playerInput);
		closeActiveTab(editorPanes);
		return true;
	}
	if (isKeyJustPressed('Tab', playerInput)) {
		consumeIdeKey('Tab', playerInput);
		cycleTab(editorPanes, isShiftDown(playerInput) ? -1 : 1);
		return true;
	}
	return false;
}
