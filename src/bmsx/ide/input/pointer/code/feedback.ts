import { isCodeTabActive } from '../../../workbench/ui/code_tab/contexts';
import { clearHoverTooltip, clearGotoHoverHighlight, refreshGotoHoverHighlight, updateHoverTooltip } from '../../../editor/contrib/intellisense/engine';
import { resolvePointerTextPosition } from '../../../editor/ui/view/view';
import type { CodeAreaBounds } from '../../../editor/ui/view/view';
import type { CodeTabContext, PointerSnapshot } from '../../../common/models';
import { isAltDown } from '../../keyboard/key_input';
import type { Runtime } from '../../../../machine/runtime/runtime';

export function updateCodeAreaPointerFeedback(
	runtime: Runtime,
	snapshot: PointerSnapshot,
	insideCodeArea: boolean,
	gotoModifierActive: boolean,
	pointerSelecting: boolean,
	activeContext: CodeTabContext,
	bounds: CodeAreaBounds
): void {
	if (isCodeTabActive() && !snapshot.primaryPressed && !pointerSelecting && insideCodeArea && gotoModifierActive) {
		const hover = resolvePointerTextPosition(snapshot.viewportX, snapshot.viewportY, bounds);
		refreshGotoHoverHighlight(runtime, hover.row, hover.column, activeContext);
	} else if (!gotoModifierActive || !insideCodeArea || snapshot.primaryPressed || pointerSelecting || !isCodeTabActive()) {
		clearGotoHoverHighlight();
	}
	if (isCodeTabActive()) {
		const altDown = isAltDown();
		if (!snapshot.primaryPressed && !pointerSelecting && insideCodeArea && altDown) {
			updateHoverTooltip(runtime, snapshot, bounds);
		} else {
			clearHoverTooltip();
		}
		return;
	}
	clearHoverTooltip();
}
