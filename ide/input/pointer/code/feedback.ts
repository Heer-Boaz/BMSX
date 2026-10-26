import type { SuspendedGuestSession } from '../../../runtime/suspended_guest';
import type { RuntimeSourceState } from '../../../runtime/sources';
import { type PointerHoverTarget } from '../hover';
import { PointerButton } from '../../../../hosts/common/input/pointer_event';
import { clearGotoHoverHighlight, refreshGotoHoverHighlight } from '../../../editor/contrib/intellisense/engine';
import { clearHoverTooltip, updateHoverTooltip } from '../../../editor/contrib/hover/controller';
import { resolvePointerTextPosition } from '../../../editor/ui/view/view';
import type { CodeAreaBounds } from '../../../editor/ui/view/view';
import type { PointerInputSnapshot } from '../../../common/models';
import type { CodeEditorContext } from '../../../editor/ui/code_editor_state';
import { isAltDown } from '../../keyboard/key_input';
import type { Runtime } from '../../../../machine/ts/machine/runtime/runtime';
import type { RuntimeFaultState } from '../../../runtime/fault_state';

export const codeAreaHover: PointerHoverTarget = {
	onPointerLeave(): void { clearHoverTooltip(); clearGotoHoverHighlight(); },
};

export function updateCodeAreaPointerFeedback(
	sources: RuntimeSourceState,
	guest: SuspendedGuestSession,
	fault: RuntimeFaultState,
	runtime: Runtime,
	snapshot: PointerInputSnapshot,
	insideCodeArea: boolean,
	gotoModifierActive: boolean,
	pointerSelecting: boolean,
	activeContext: CodeEditorContext,
	bounds: CodeAreaBounds
): void {
	if ((snapshot.pressedButtons & PointerButton.Primary) === 0 && !pointerSelecting && insideCodeArea && gotoModifierActive) {
		const hover = resolvePointerTextPosition(snapshot.viewportX, snapshot.viewportY, bounds);
		if (hover.injected) clearGotoHoverHighlight();
		else refreshGotoHoverHighlight(sources, hover.row, hover.column, activeContext);
	} else if (!gotoModifierActive || !insideCodeArea || ((snapshot.pressedButtons & PointerButton.Primary) !== 0) || pointerSelecting) {
		clearGotoHoverHighlight();
	}
	{
		const altDown = isAltDown(snapshot);
		if ((snapshot.pressedButtons & PointerButton.Primary) === 0 && !pointerSelecting && insideCodeArea && altDown) {
			const hover = resolvePointerTextPosition(snapshot.viewportX, snapshot.viewportY, bounds);
			if (hover.injected) clearHoverTooltip();
			else updateHoverTooltip(sources, guest, fault, runtime, activeContext, hover.row, hover.column);
		} else {
			clearHoverTooltip();
		}
		return;
	}
	clearHoverTooltip();
}
