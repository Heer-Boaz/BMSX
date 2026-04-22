import { $ } from '../../../../core/engine';
import { getActiveCodeTabContext } from '../../../workbench/ui/code_tab/contexts';
import { clearHoverTooltip, clearGotoHoverHighlight } from '../../contrib/intellisense/engine';
import { handleEditorContextMenuPointer } from '../../../workbench/input/pointer/context_menu/input';
import { isCtrlDown, isMetaDown } from '../keyboard/key_input';
import { computeEditorPointerButtonMask, POINTER_AUX_JUST_PRESSED, POINTER_PRIMARY_JUST_PRESSED, POINTER_PRIMARY_JUST_RELEASED, POINTER_SECONDARY_JUST_PRESSED } from './buttons';
import { handleCodeAreaPointerInput } from './code';
import { handleEditorPanelPointer } from './panel';
import { handleEditorChromePointerDispatch } from './chrome/dispatch';
import { prepareEditorPointerFrame, readEditorPointerSnapshot } from './frame';
import { handleEditorPointerGuards } from './guard_dispatch';
import { editorPointerState } from './state';
import { handleInlineWidgetPointer } from '../../contrib/quick_input/inline_widget';

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
	if (handleInlineWidgetPointer(snapshot, justPressed)) {
		return;
	}
	handleCodeAreaPointerInput(snapshot, justPressed, gotoModifierActive, activeContext, pointerSecondaryJustPressed, playerInput);
}
