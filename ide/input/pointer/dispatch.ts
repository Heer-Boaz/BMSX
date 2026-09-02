import type { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import type { PlayerInput } from '../../../hosts/common/input/player';
import { clearGotoHoverHighlight } from '../../editor/contrib/intellisense/engine';
import { clearHoverTooltip } from '../../editor/contrib/hover/controller';
import { computeEditorPointerButtonMask, POINTER_AUX_JUST_PRESSED, POINTER_PRIMARY_JUST_PRESSED, POINTER_PRIMARY_JUST_RELEASED, POINTER_SECONDARY_JUST_PRESSED } from './buttons';
import { handleCodeAreaPointerInput } from './code/index';
import { prepareEditorPointerFrame, readEditorPointerSnapshot } from './frame';
import { handleEditorPanelPointer } from './panel';
import { editorPointerState, stopPointerSelectionAndResetClicks } from './state';
import { isCtrlDown, isMetaDown } from '../keyboard/key_input';
import { handleQuickInputPointer } from '../quick_input/pointer/dispatch';
import { handleEditorContextMenuPointer } from './context_menu/input';
import { handleEditorChromePointerDispatch } from './chrome_dispatch';
import type { CartEditor } from '../../cart_editor';
import type { RuntimeSourceState } from '../../runtime/sources';
import type { RuntimeLuaTooling } from '../../runtime/lua_tooling';
import type { RuntimeFaultState } from '../../runtime/fault_state';
import type { Clipboard } from '../../common/clipboard';
import type { MicrotaskQueue } from '../../common/microtask_queue';
import type { EditorDisplay } from '../../common/viewport';
import { getActiveTab } from '../../workbench/ui/tabs';
import { handleBlockingWorkbenchModalPointer, hasBlockingWorkbenchModal } from '../../workbench/contrib/modal/blocking_modal';

export function handleTextEditorPointerInput(
	display: EditorDisplay,
	playerInput: PlayerInput,
	now: number,
	clipboard: Clipboard,
	microtasks: MicrotaskQueue,
	editor: CartEditor,
	sources: RuntimeSourceState,
	luaTooling: RuntimeLuaTooling,
	fault: RuntimeFaultState,
	runtime: Runtime,
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
	if (handleEditorPanelPointer(editor.resourcePanel, snapshot, justPressed, justReleased)) {
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
	let workbenchViewPointerHandled = false;
	switch (activeTab.kind) {
		case 'resource_view':
			break;
		case 'behavior_lens':
			workbenchViewPointerHandled = editor.behaviorLens.handlePointer(
				activeTab.view,
				snapshot,
				justPressed,
				now,
			);
			break;
		case 'scenario_lab':
			workbenchViewPointerHandled = editor.scenarioLab.handlePointer(
				activeTab.view,
				snapshot,
				justPressed,
				now,
			);
			break;
		case 'code_editor':
			if (handleQuickInputPointer(microtasks, editor, sources, snapshot, justPressed)) {
				return;
			}
			handleCodeAreaPointerInput(
				editor,
				luaTooling,
				fault,
				runtime,
				snapshot,
				justPressed,
				gotoModifierActive,
				activeTab.context,
				pointerSecondaryJustPressed,
				playerInput,
				now,
				clipboard,
			);
			return;
	}
	if (workbenchViewPointerHandled && justPressed) {
		playerInput.inputHandlers.pointer?.consumeButton('pointer_primary');
	}
	stopPointerSelectionAndResetClicks(snapshot);
	editorPointerState.lastPointerRowResolution = null;
	clearHoverTooltip();
	clearGotoHoverHighlight();
}
