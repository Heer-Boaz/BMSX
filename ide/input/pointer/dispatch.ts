import type { PlayerInput } from '../../../hosts/common/input/player';
import { PointerButton } from './buttons';
import { prepareEditorPointerFrame, readEditorPointerSnapshot } from './frame';
import { handleEditorPanelPointer } from './panel';
import { clearEditorPointerSelectionState } from './state';
import { isCtrlDown, isMetaDown } from '../keyboard/key_input';
import { handleEditorChromePointerDispatch } from './chrome_dispatch';
import type { CartEditor } from '../../cart_editor';
import type { RuntimeSourceState } from '../../runtime/sources';
import type { EditorDisplay } from '../../common/viewport';
import { handleBlockingWorkbenchModalPointer, hasBlockingWorkbenchModal } from '../../workbench/contrib/modal/blocking_modal';
import { pointerCapture } from './capture';
import { pointerHover } from './hover';
import { editorChromeState } from '../../workbench/ui/chrome_state';

export function handleTextEditorPointerInput(
	display: EditorDisplay,
	playerInput: PlayerInput,
	now: number,
	editor: CartEditor,
	sources: RuntimeSourceState,
): void {
	pointerHover.beginDispatch();
	try {
		const ctrlDown = isCtrlDown(playerInput);
		const metaDown = isMetaDown(playerInput);
		const gotoModifierActive = ctrlDown || metaDown;
		const snapshot = readEditorPointerSnapshot(display, playerInput);
		const blockingModal = hasBlockingWorkbenchModal();
		const quickInputVisible = editor.quickInput.visible;
		const justReleased = (snapshot.justReleasedButtons & PointerButton.Primary) !== 0;
		if (pointerCapture.dispatch(snapshot, blockingModal || quickInputVisible
			|| editorChromeState.openMenuId !== null, now)) return;
		if (prepareEditorPointerFrame(snapshot, gotoModifierActive, blockingModal || quickInputVisible
			|| editor.contextMenu.visible || editorChromeState.openMenuId !== null)) {
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
			return;
		}
		if (quickInputVisible) {
			if (snapshot.valid) editor.quickInput.handlePointer(snapshot, justPressed);
			clearEditorPointerSelectionState();
			return;
		}
		if (editor.contextMenu.visible && editor.contextMenu.handlePointer(snapshot)) {
			clearEditorPointerSelectionState();
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
	} finally {
		pointerHover.endDispatch();
	}
}
