import { isCodeTabActive } from '../../../workbench/ui/code_tab/contexts';
import { clearHoverTooltip, clearGotoHoverHighlight, refreshGotoHoverHighlight, updateHoverTooltip } from '../../../editor/contrib/intellisense/engine';
import { resolvePointerTextPosition } from '../../../editor/ui/view/view';
import type { CodeAreaBounds } from '../../../editor/ui/view/view';
import type { PointerSnapshot } from '../../../common/models';
import type { EditorDocumentContext } from '../../../editor/editing/document_state';
import { isAltDown } from '../../keyboard/key_input';
import type { Runtime } from '../../../../machine/ts/machine/runtime/runtime';
import type { RuntimeLuaTooling } from '../../../runtime/lua_tooling';
import type { RuntimeFaultState } from '../../../runtime/fault_state';
import type { PlayerInput } from '../../../../hosts/common/input/player';

export function updateCodeAreaPointerFeedback(
	playerInput: PlayerInput,
	bridge: RuntimeLuaTooling,
	fault: RuntimeFaultState,
	runtime: Runtime,
	snapshot: PointerSnapshot,
	insideCodeArea: boolean,
	gotoModifierActive: boolean,
	pointerSelecting: boolean,
	activeContext: EditorDocumentContext,
	bounds: CodeAreaBounds
): void {
	if (isCodeTabActive() && !snapshot.primaryPressed && !pointerSelecting && insideCodeArea && gotoModifierActive) {
		const hover = resolvePointerTextPosition(snapshot.viewportX, snapshot.viewportY, bounds);
			refreshGotoHoverHighlight(bridge, fault, runtime, hover.row, hover.column, activeContext);
	} else if (!gotoModifierActive || !insideCodeArea || snapshot.primaryPressed || pointerSelecting || !isCodeTabActive()) {
		clearGotoHoverHighlight();
	}
	if (isCodeTabActive()) {
		const altDown = isAltDown(playerInput);
		if (!snapshot.primaryPressed && !pointerSelecting && insideCodeArea && altDown) {
				updateHoverTooltip(bridge, fault, runtime, snapshot, activeContext, bounds);
		} else {
			clearHoverTooltip();
		}
		return;
	}
	clearHoverTooltip();
}
