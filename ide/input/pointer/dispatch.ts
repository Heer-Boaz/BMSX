import type { PointerInputSnapshot } from '../../common/models';
import { PointerButton } from '../../../hosts/common/input/pointer_event';
import { prepareEditorPointerFrame } from './frame';
import { handleEditorPanelPointer } from './panel';
import { clearEditorPointerSelectionState, editorPointerState } from './state';
import { isCtrlDown, isMetaDown } from '../keyboard/key_input';
import { handleEditorChromePointerDispatch } from './chrome_dispatch';
import type { CartEditor } from '../../cart_editor';
import { pointerCapture, WORKBENCH_POINTER_SCOPE } from './capture';
import { pointerHover } from './hover';
import { editorChromeState } from '../../workbench/ui/chrome_state';
import { point_in_rect } from '../../../machine/ts/common/rect';
import { inputFocus } from '../focus';

export function handleTextEditorPointerInput(
	snapshot: PointerInputSnapshot,
	now: number,
	editor: CartEditor,
): void {
	pointerHover.beginDispatch();
	try {
		const ctrlDown = isCtrlDown(snapshot);
		const metaDown = isMetaDown(snapshot);
		const gotoModifierActive = ctrlDown || metaDown;
		const focused = inputFocus.target;
		if (focused?.guestInput !== undefined && snapshot.valid && snapshot.justPressedButtons !== 0
			&& (!snapshot.insideViewport || !point_in_rect(snapshot.viewportX, snapshot.viewportY, focused.guestInput.bounds))) {
			focused.release();
		}
		const blockingModal = editor.actionPrompt.visible;
		const quickInputVisible = editor.quickInput.visible;
		const captureScope = blockingModal ? editor.actionPrompt.pointerScope : quickInputVisible ? editor.quickInput.pointerScope
			: editor.contextMenu.visible ? editor.contextMenu.pointerScope : WORKBENCH_POINTER_SCOPE;
		editorPointerState.lastPointerSnapshot = snapshot.valid ? snapshot : null;
		const justReleased = (snapshot.justReleasedButtons & PointerButton.Primary) !== 0;
		if (pointerCapture.dispatch(snapshot, captureScope === WORKBENCH_POINTER_SCOPE && editorChromeState.openMenuId !== null, now, captureScope)) return;
		prepareEditorPointerFrame(snapshot, gotoModifierActive, blockingModal || quickInputVisible
			|| editor.contextMenu.visible || editorChromeState.openMenuId !== null);
		const justPressed = (snapshot.justPressedButtons & PointerButton.Primary) !== 0;
		const pointerSecondaryJustPressed = (snapshot.justPressedButtons & PointerButton.Secondary) !== 0;
		const pointerAuxJustPressed = (snapshot.justPressedButtons & PointerButton.Auxiliary) !== 0;
		if (blockingModal) {
			editor.actionPrompt.handlePointer(snapshot);
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
		if (handleEditorChromePointerDispatch(editor, snapshot, justPressed, pointerAuxJustPressed)) {
			return;
		}
		if (handleEditorPanelPointer(editor.resourcePanel, editor.editorPanes, snapshot, justPressed, justReleased)) {
			return;
		}

		editor.editorPanes.activePane?.handlePointer(
			snapshot,
			justPressed,
			pointerSecondaryJustPressed,
			now,
			gotoModifierActive,
		);
		// A complete short click may create and release capture in this same host poll.
		if (snapshot.justReleasedButtons !== 0) pointerCapture.dispatch(snapshot, false, now);
	} finally {
		pointerHover.endDispatch();
	}
}
