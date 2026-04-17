import { isCodeTabActive } from '../../../workbench/ui/code_tab/contexts';
import { clearHoverTooltip, clearGotoHoverHighlight, refreshGotoHoverHighlight, updateHoverTooltip } from '../../contrib/intellisense/engine';
import { resolvePointerColumn, resolvePointerRow } from '../../ui/view';
import type { CodeTabContext, PointerSnapshot } from '../../../common/models';
import { isAltDown } from '../keyboard/key_input';

export function updateCodeAreaPointerFeedback(
	snapshot: PointerSnapshot,
	insideCodeArea: boolean,
	gotoModifierActive: boolean,
	pointerSelecting: boolean,
	activeContext: CodeTabContext
): void {
	if (isCodeTabActive() && !snapshot.primaryPressed && !pointerSelecting && insideCodeArea && gotoModifierActive) {
		const hoverRow = resolvePointerRow(snapshot.viewportY);
		const hoverColumn = resolvePointerColumn(hoverRow, snapshot.viewportX);
		refreshGotoHoverHighlight(hoverRow, hoverColumn, activeContext);
	} else if (!gotoModifierActive || !insideCodeArea || snapshot.primaryPressed || pointerSelecting || !isCodeTabActive()) {
		clearGotoHoverHighlight();
	}
	if (isCodeTabActive()) {
		const altDown = isAltDown();
		if (!snapshot.primaryPressed && !pointerSelecting && insideCodeArea && altDown) {
			updateHoverTooltip(snapshot);
		} else {
			clearHoverTooltip();
		}
		return;
	}
	clearHoverTooltip();
}
