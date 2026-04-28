import { engineCore } from '../../../core/engine';
import type { Runtime } from '../../../machine/runtime/runtime';
import { clearGotoHoverHighlight, clearHoverTooltip } from '../../editor/contrib/intellisense/engine';
import { computeEditorPointerButtonMask, POINTER_AUX_JUST_PRESSED, POINTER_PRIMARY_JUST_PRESSED, POINTER_PRIMARY_JUST_RELEASED, POINTER_SECONDARY_JUST_PRESSED } from './buttons';
import { handleCodeAreaPointerInput } from './code';
import { prepareEditorPointerFrame, readEditorPointerSnapshot } from './frame';
import { handleEditorPointerGuards } from './guard_dispatch';
import { handleEditorPanelPointer } from './panel';
import { editorPointerState } from './state';
import { isCtrlDown, isMetaDown } from '../keyboard/key_input';
import { handleQuickInputPointer } from '../quick_input/pointer/dispatch';
import { handleEditorContextMenuPointer } from './context_menu/input';
import { getActiveCodeTabContext } from '../../workbench/ui/code_tab/contexts';
import { handleEditorChromePointerDispatch } from './chrome_dispatch';

export function handleTextEditorPointerInput(runtime: Runtime): void {
	const ctrlDown = isCtrlDown();
	const metaDown = isMetaDown();
	const gotoModifierActive = ctrlDown || metaDown;
	const activeContext = getActiveCodeTabContext();
	const snapshot = readEditorPointerSnapshot();
	if (prepareEditorPointerFrame(runtime.editor.resourcePanel, snapshot, gotoModifierActive)) {
		return;
	}
	const playerInput = engineCore.input.getPlayerInput(1);
	const buttonMask = computeEditorPointerButtonMask(playerInput, snapshot.primaryPressed);
	const justPressed = (buttonMask & POINTER_PRIMARY_JUST_PRESSED) !== 0;
	const justReleased = (buttonMask & POINTER_PRIMARY_JUST_RELEASED) !== 0;
	const pointerSecondaryJustPressed = (buttonMask & POINTER_SECONDARY_JUST_PRESSED) !== 0;
	const pointerAuxJustPressed = (buttonMask & POINTER_AUX_JUST_PRESSED) !== 0;
	if (handleEditorContextMenuPointer(runtime, snapshot, justPressed, pointerSecondaryJustPressed, playerInput)) {
		editorPointerState.pointerPrimaryWasPressed = snapshot.primaryPressed;
		clearHoverTooltip();
		clearGotoHoverHighlight();
		return;
	}
	if (handleEditorChromePointerDispatch(runtime, snapshot, justPressed, pointerAuxJustPressed, playerInput)) {
		return;
	}
	if (handleEditorPanelPointer(runtime, snapshot, justPressed, justReleased)) {
		return;
	}
	if (handleEditorPointerGuards(runtime, snapshot, justPressed)) {
		return;
	}
	if (handleQuickInputPointer(runtime, snapshot, justPressed)) {
		return;
	}
	handleCodeAreaPointerInput(runtime, snapshot, justPressed, gotoModifierActive, activeContext, pointerSecondaryJustPressed, playerInput);
}
