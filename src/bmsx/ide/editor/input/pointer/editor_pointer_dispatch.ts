import { $ } from '../../../../core/engine_core';
import { getActiveCodeTabContext } from '../../../workbench/ui/tabs';
import { clearHoverTooltip, clearGotoHoverHighlight } from '../../contrib/intellisense/intellisense';
import { handleEditorContextMenuPointer } from '../../../workbench/input/pointer/context_menu_input';
import { isCtrlDown, isMetaDown } from '../keyboard/key_input';
import { computeEditorPointerButtonMask, POINTER_AUX_JUST_PRESSED, POINTER_PRIMARY_JUST_PRESSED, POINTER_PRIMARY_JUST_RELEASED, POINTER_SECONDARY_JUST_PRESSED } from './editor_pointer_buttons';
import { handleQuickInputPointer } from '../quick_input/editor_quick_input_pointer';
import { handleCodeAreaPointerInput } from './editor_code_pointer';
import { handleEditorPanelPointer } from './editor_panel_pointer';
import { handleEditorChromePointerDispatch } from './editor_pointer_chrome_dispatch';
import { prepareEditorPointerFrame, readEditorPointerSnapshot } from './editor_pointer_frame';
import { handleEditorPointerGuards } from './editor_pointer_guard_dispatch';
import { editorPointerState } from './editor_pointer_state';

export function handleTextEditorPointerInput(): void {
	const ctrlDown = isCtrlDown();
	const metaDown = isMetaDown();
	const gotoModifierActive = ctrlDown || metaDown;
	const activeContext = getActiveCodeTabContext();
	const snapshot = readEditorPointerSnapshot();
	if (prepareEditorPointerFrame(snapshot, gotoModifierActive)) {
		return;
	}
	const playerInput = $.input.getPlayerInput(1);
	const buttonMask = computeEditorPointerButtonMask(playerInput, snapshot.primaryPressed);
	const justPressed = (buttonMask & POINTER_PRIMARY_JUST_PRESSED) !== 0;
	const justReleased = (buttonMask & POINTER_PRIMARY_JUST_RELEASED) !== 0;
	const pointerSecondaryJustPressed = (buttonMask & POINTER_SECONDARY_JUST_PRESSED) !== 0;
	const pointerAuxJustPressed = (buttonMask & POINTER_AUX_JUST_PRESSED) !== 0;
	if (handleEditorContextMenuPointer(snapshot, justPressed, pointerSecondaryJustPressed, playerInput)) {
		editorPointerState.pointerPrimaryWasPressed = snapshot.primaryPressed;
		clearHoverTooltip();
		clearGotoHoverHighlight();
		return;
	}
	if (handleEditorChromePointerDispatch(snapshot, justPressed, pointerAuxJustPressed, playerInput)) {
		return;
	}
	if (handleEditorPanelPointer(snapshot, justPressed, justReleased)) {
		return;
	}
	if (handleEditorPointerGuards(snapshot, justPressed)) {
		return;
	}
	if (handleQuickInputPointer(snapshot, justPressed)) {
		return;
	}
	handleCodeAreaPointerInput(snapshot, justPressed, gotoModifierActive, activeContext, pointerSecondaryJustPressed, playerInput);
}
