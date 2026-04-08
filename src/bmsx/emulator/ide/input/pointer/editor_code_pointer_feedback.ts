import { isCodeTabActive } from '../../browser/editor_tabs';
import { clearHoverTooltip, clearGotoHoverHighlight, refreshGotoHoverHighlight, updateHoverTooltip } from '../../contrib/intellisense/intellisense';
import { resolvePointerColumn, resolvePointerRow } from '../../browser/editor_view';
import type { CodeTabContext, PointerSnapshot } from '../../core/types';
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
