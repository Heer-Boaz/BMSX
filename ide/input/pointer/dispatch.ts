import type { PlayerInput } from '../../../hosts/common/input/player';
import { clearGotoHoverHighlight } from '../../editor/contrib/intellisense/engine';
import { clearHoverTooltip } from '../../editor/contrib/hover/controller';
import { PointerButton } from './buttons';
import { prepareEditorPointerFrame, readEditorPointerSnapshot } from './frame';
import { handleEditorPanelPointer } from './panel';
import { clearEditorPointerSelectionState } from './state';
import { isCtrlDown, isMetaDown } from '../keyboard/key_input';
import { handleEditorContextMenuPointer } from './context_menu/input';
import { handleEditorChromePointerDispatch } from './chrome_dispatch';
import type { CartEditor } from '../../cart_editor';
import type { RuntimeSourceState } from '../../runtime/sources';
import type { Clipboard } from '../../common/clipboard';
import type { EditorDisplay } from '../../common/viewport';
import { getActiveTab } from '../../workbench/ui/tabs';
import { handleBlockingWorkbenchModalPointer, hasBlockingWorkbenchModal } from '../../workbench/contrib/modal/blocking_modal';
import { pointerCapture } from './capture';
import { editorChromeState } from '../../workbench/ui/chrome_state';
import { editorContextMenuState } from '../../workbench/contrib/context_menu/state';

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
	const blockingModal = hasBlockingWorkbenchModal();
	const quickInputVisible = editor.quickInput.visible;
	const justReleased = (snapshot.justReleasedButtons & PointerButton.Primary) !== 0;
	if (pointerCapture.dispatch(snapshot, blockingModal || quickInputVisible
		|| editorChromeState.openMenuId !== null || editorContextMenuState.visible, now)) return;
	if (prepareEditorPointerFrame(snapshot, gotoModifierActive, blockingModal || quickInputVisible)) {
		return;
	}
	const justPressed = (snapshot.justPressedButtons & PointerButton.Primary) !== 0;
	const pointerSecondaryJustPressed = (snapshot.justPressedButtons & PointerButton.Secondary) !== 0;
	const pointerAuxJustPressed = (snapshot.justPressedButtons & PointerButton.Auxiliary) !== 0;
	if (blockingModal) {
		if (justPressed) {
			handleBlockingWorkbenchModalPointer(editor, snapshot);
		}
		clearEditorPointerSelectionState();
		clearHoverTooltip();
		clearGotoHoverHighlight();
		return;
	}
	if (quickInputVisible) {
		if (snapshot.valid) editor.quickInput.handlePointer(snapshot, justPressed);
		clearEditorPointerSelectionState();
		clearHoverTooltip();
		clearGotoHoverHighlight();
		return;
	}
	const activeTab = getActiveTab();
	if (activeTab.kind === 'code_editor' && handleEditorContextMenuPointer(
		clipboard,
		editor,
		snapshot,
		justPressed,
		pointerSecondaryJustPressed,
		playerInput,
	)) {
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

	editor.editorPanes.activePane.handlePointer(
		snapshot,
		justPressed,
		pointerSecondaryJustPressed,
		playerInput,
		now,
		gotoModifierActive,
	);
	// A complete short click may create and release capture in this same host poll.
	if (snapshot.justReleasedButtons !== 0) pointerCapture.dispatch(snapshot, false, now);
}
