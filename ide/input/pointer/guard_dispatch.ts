import { isResourceViewActive } from '../../workbench/ui/tabs';
import { clearHoverTooltip, clearGotoHoverHighlight } from '../../editor/contrib/intellisense/engine';
import type { PointerSnapshot } from '../../common/models';
import type { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { handleBlockingWorkbenchModalPointer, hasBlockingWorkbenchModal } from '../../workbench/contrib/modal/blocking_modal';
import { stopPointerSelectionAndResetClicks } from './state';
import type { CartEditor } from '../../cart_editor';
import type { RuntimeSourceState } from '../../runtime/sources';
import type { RuntimeFaultState } from '../../runtime/fault_state';
import type { RuntimeLuaTooling } from '../../runtime/lua_tooling';
import type { GateGroup } from '../../../machine/ts/common/taskgate';
import type { OverlayRenderer } from '../../runtime/overlay_renderer';

export function handleEditorPointerGuards(
	editor: CartEditor,
	sources: RuntimeSourceState,
	luaTooling: RuntimeLuaTooling,
	fault: RuntimeFaultState,
	luaGate: GateGroup,
	overlayRenderer: OverlayRenderer,
	runtime: Runtime,
	snapshot: PointerSnapshot,
	justPressed: boolean,
): boolean {
	if (isResourceViewActive()) {
		stopPointerSelectionAndResetClicks(snapshot);
		clearHoverTooltip();
		clearGotoHoverHighlight();
		return true;
	}
	if (!hasBlockingWorkbenchModal()) {
		return false;
	}
	if (justPressed) {
		handleBlockingWorkbenchModalPointer(
			editor,
			sources,
			luaTooling,
			fault,
			luaGate,
			overlayRenderer,
			runtime,
			snapshot,
		);
	}
	stopPointerSelectionAndResetClicks(snapshot);
	clearHoverTooltip();
	clearGotoHoverHighlight();
	return true;
}
