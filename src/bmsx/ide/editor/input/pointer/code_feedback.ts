import { isCodeTabActive } from '../../../workbench/ui/code_tab/contexts';
import { clearHoverTooltip, clearGotoHoverHighlight, refreshGotoHoverHighlight, updateHoverTooltip } from '../../contrib/intellisense/engine';
import { resolvePointerTextPosition } from '../../ui/view';
import type { CodeAreaBounds } from '../../ui/view';
import type { CodeTabContext, PointerSnapshot } from '../../../common/models';
import { isAltDown } from '../keyboard/key_input';

export function updateCodeAreaPointerFeedback(
	snapshot: PointerSnapshot,
	insideCodeArea: boolean,
	gotoModifierActive: boolean,
	pointerSelecting: boolean,
	activeContext: CodeTabContext,
	bounds: CodeAreaBounds
): void {
	if (isCodeTabActive() && !snapshot.primaryPressed && !pointerSelecting && insideCodeArea && gotoModifierActive) {
		const hover = resolvePointerTextPosition(snapshot.viewportX, snapshot.viewportY, bounds);
		refreshGotoHoverHighlight(hover.row, hover.column, activeContext);
	} else if (!gotoModifierActive || !insideCodeArea || snapshot.primaryPressed || pointerSelecting || !isCodeTabActive()) {
		clearGotoHoverHighlight();
	}
	if (isCodeTabActive()) {
		const altDown = isAltDown();
		if (!snapshot.primaryPressed && !pointerSelecting && insideCodeArea && altDown) {
			updateHoverTooltip(snapshot, bounds);
		} else {
			clearHoverTooltip();
		}
		return;
	}
	clearHoverTooltip();
}
