import { machineManager } from '../../../machine/ts/core/machine_manager';
import type { Runtime } from '../../../machine/ts/machine/runtime/runtime';
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
import type { GateGroup } from '../../../machine/ts/common/taskgate';
import type { OverlayRenderer } from '../../runtime/overlay_renderer';

export function handleTextEditorPointerInput(
	editor: CartEditor,
	sources: RuntimeSourceState,
	luaTooling: RuntimeLuaTooling,
	fault: RuntimeFaultState,
	luaGate: GateGroup,
	overlayRenderer: OverlayRenderer,
	runtime: Runtime,
): void {
	const ctrlDown = isCtrlDown();
	const metaDown = isMetaDown();
	const gotoModifierActive = ctrlDown || metaDown;
	const activeContext = getActiveCodeTabContext();
	const snapshot = readEditorPointerSnapshot();
	if (prepareEditorPointerFrame(editor.resourcePanel, snapshot, gotoModifierActive)) {
		return;
	}
	const playerInput = machineManager.input.getPlayerInput(1);
	const buttonMask = computeEditorPointerButtonMask(playerInput, snapshot.primaryPressed);
	const justPressed = (buttonMask & POINTER_PRIMARY_JUST_PRESSED) !== 0;
	const justReleased = (buttonMask & POINTER_PRIMARY_JUST_RELEASED) !== 0;
	const pointerSecondaryJustPressed = (buttonMask & POINTER_SECONDARY_JUST_PRESSED) !== 0;
	const pointerAuxJustPressed = (buttonMask & POINTER_AUX_JUST_PRESSED) !== 0;
	if (handleEditorContextMenuPointer(editor, snapshot, justPressed, pointerSecondaryJustPressed, playerInput)) {
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
		sources,
		luaTooling,
		fault,
		luaGate,
		overlayRenderer,
		runtime,
		snapshot,
		justPressed,
	)) {
		return;
	}
	if (handleQuickInputPointer(editor, sources, snapshot, justPressed)) {
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
	);
}
