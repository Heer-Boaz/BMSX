import { isCodeTabActive } from '../../../workbench/ui/tabs';
import { clearGotoHoverHighlight, refreshGotoHoverHighlight } from '../../../editor/contrib/intellisense/engine';
import { clearHoverTooltip, updateHoverTooltip } from '../../../editor/contrib/hover/controller';
import { resolvePointerTextPosition } from '../../../editor/ui/view/view';
import type { CodeAreaBounds } from '../../../editor/ui/view/view';
import type { PointerSnapshot } from '../../../common/models';
import type { CodeEditorContext } from '../../../editor/ui/code_editor_state';
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
	activeContext: CodeEditorContext,
	bounds: CodeAreaBounds
): void {
	if (isCodeTabActive() && !snapshot.primaryPressed && !pointerSelecting && insideCodeArea && gotoModifierActive) {
		const hover = resolvePointerTextPosition(snapshot.viewportX, snapshot.viewportY, bounds);
			refreshGotoHoverHighlight(bridge, hover.row, hover.column, activeContext);
	} else if (!gotoModifierActive || !insideCodeArea || snapshot.primaryPressed || pointerSelecting || !isCodeTabActive()) {
		clearGotoHoverHighlight();
	}
	if (isCodeTabActive()) {
		const altDown = isAltDown(playerInput);
		if (!snapshot.primaryPressed && !pointerSelecting && insideCodeArea && altDown) {
			const hover = resolvePointerTextPosition(snapshot.viewportX, snapshot.viewportY, bounds);
			updateHoverTooltip(bridge, fault, runtime, activeContext, hover.row, hover.column);
		} else {
			clearHoverTooltip();
		}
		return;
	}
	clearHoverTooltip();
}
