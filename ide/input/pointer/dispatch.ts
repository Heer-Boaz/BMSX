import type { PlayerInput } from '../../../hosts/common/input/player';
import { clearGotoHoverHighlight } from '../../editor/contrib/intellisense/engine';
import { clearHoverTooltip } from '../../editor/contrib/hover/controller';
import { computeEditorPointerButtonMask, POINTER_AUX_JUST_PRESSED, POINTER_PRIMARY_JUST_PRESSED, POINTER_PRIMARY_JUST_RELEASED, POINTER_SECONDARY_JUST_PRESSED } from './buttons';
import { prepareEditorPointerFrame, readEditorPointerSnapshot } from './frame';
import { handleEditorPanelPointer } from './panel';
import { editorPointerState, stopPointerSelectionAndResetClicks } from './state';
import { isCtrlDown, isMetaDown } from '../keyboard/key_input';
import { handleEditorContextMenuPointer } from './context_menu/input';
import { handleEditorChromePointerDispatch } from './chrome_dispatch';
import type { CartEditor } from '../../cart_editor';
import type { RuntimeSourceState } from '../../runtime/sources';
import type { Clipboard } from '../../common/clipboard';
import type { EditorDisplay } from '../../common/viewport';
import { getActiveTab } from '../../workbench/ui/tabs';
import { handleBlockingWorkbenchModalPointer, hasBlockingWorkbenchModal } from '../../workbench/contrib/modal/blocking_modal';

export function handleTextEditorPointerInput(
	display: EditorDisplay,
	playerInput: PlayerInput,
	now: number,
	clipboard: Clipboard,
	editor: CartEditor,
	sources: RuntimeSourceState,
): void {
	const ctrlDown = isCtrlDown(playerInput);
	const metaDown = isMetaDown(playerInput);
	const gotoModifierActive = ctrlDown || metaDown;
	const snapshot = readEditorPointerSnapshot(display, playerInput);
	if (prepareEditorPointerFrame(editor.resourcePanel, snapshot, gotoModifierActive)) {
		return;
	}
	const buttonMask = computeEditorPointerButtonMask(playerInput, snapshot.primaryPressed);
	const justPressed = (buttonMask & POINTER_PRIMARY_JUST_PRESSED) !== 0;
	const justReleased = (buttonMask & POINTER_PRIMARY_JUST_RELEASED) !== 0;
	const pointerSecondaryJustPressed = (buttonMask & POINTER_SECONDARY_JUST_PRESSED) !== 0;
	const pointerAuxJustPressed = (buttonMask & POINTER_AUX_JUST_PRESSED) !== 0;
	const activeTab = getActiveTab();
	if (activeTab.kind === 'code_editor' && handleEditorContextMenuPointer(
		clipboard,
		editor,
		snapshot,
		justPressed,
		pointerSecondaryJustPressed,
		playerInput,
	)) {
		editorPointerState.pointerPrimaryWasPressed = snapshot.primaryPressed;
		clearHoverTooltip();
		clearGotoHoverHighlight();
		return;
	}
	if (handleEditorChromePointerDispatch(editor, sources, snapshot, justPressed, pointerAuxJustPressed, playerInput)) {
		return;
	}
	if (handleEditorPanelPointer(editor.resourcePanel, editor.editorPanes, snapshot, justPressed, justReleased)) {
		return;
	}
	if (hasBlockingWorkbenchModal()) {
		if (justPressed) {
			handleBlockingWorkbenchModalPointer(editor, snapshot);
		}
		stopPointerSelectionAndResetClicks(snapshot);
		clearHoverTooltip();
		clearGotoHoverHighlight();
		return;
	}
	editor.editorPanes.activePane.handlePointer(
		snapshot,
		justPressed,
		pointerSecondaryJustPressed,
		playerInput,
		now,
		gotoModifierActive,
	);
}
