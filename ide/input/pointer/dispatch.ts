import type { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import type { PlayerInput } from '../../../hosts/common/input/player';
import { clearGotoHoverHighlight, clearHoverTooltip } from '../../editor/contrib/intellisense/engine';
import { computeEditorPointerButtonMask, POINTER_AUX_JUST_PRESSED, POINTER_PRIMARY_JUST_PRESSED, POINTER_PRIMARY_JUST_RELEASED, POINTER_SECONDARY_JUST_PRESSED } from './buttons';
import { handleCodeAreaPointerInput } from './code/index';
import { prepareEditorPointerFrame, readEditorPointerSnapshot } from './frame';
import { handleEditorPointerGuards } from './guard_dispatch';
import { handleEditorPanelPointer } from './panel';
import { editorPointerState } from './state';
import { isCtrlDown, isMetaDown } from '../keyboard/key_input';
import { handleQuickInputPointer } from '../quick_input/pointer/dispatch';
import { handleEditorContextMenuPointer } from './context_menu/input';
import { getActiveCodeTabContext } from '../../workbench/ui/code_tab/contexts';
import { handleEditorChromePointerDispatch } from './chrome_dispatch';
import type { CartEditor } from '../../cart_editor';
import type { RuntimeSourceState } from '../../runtime/sources';
import type { RuntimeLuaTooling } from '../../runtime/lua_tooling';
import type { RuntimeFaultState } from '../../runtime/fault_state';
import type { Clipboard } from '../../common/clipboard';
import type { MicrotaskQueue } from '../../common/microtask_queue';
import type { EditorDisplay } from '../../common/viewport';

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
	const activeContext = getActiveCodeTabContext();
	const snapshot = readEditorPointerSnapshot(display, playerInput);
	if (prepareEditorPointerFrame(editor.resourcePanel, snapshot, gotoModifierActive)) {
		return;
	}
	const buttonMask = computeEditorPointerButtonMask(playerInput, snapshot.primaryPressed);
	const justPressed = (buttonMask & POINTER_PRIMARY_JUST_PRESSED) !== 0;
	const justReleased = (buttonMask & POINTER_PRIMARY_JUST_RELEASED) !== 0;
	const pointerSecondaryJustPressed = (buttonMask & POINTER_SECONDARY_JUST_PRESSED) !== 0;
	const pointerAuxJustPressed = (buttonMask & POINTER_AUX_JUST_PRESSED) !== 0;
	if (handleEditorContextMenuPointer(
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
	if (handleEditorPointerGuards(
		editor,
		snapshot,
		justPressed,
	)) {
		return;
	}
	if (handleQuickInputPointer(microtasks, editor, sources, snapshot, justPressed)) {
		return;
	}
	handleCodeAreaPointerInput(
		editor,
		sources,
		luaTooling,
		fault,
		runtime,
		snapshot,
		justPressed,
		gotoModifierActive,
		activeContext,
		pointerSecondaryJustPressed,
		playerInput,
		now,
		clipboard,
	);
}
