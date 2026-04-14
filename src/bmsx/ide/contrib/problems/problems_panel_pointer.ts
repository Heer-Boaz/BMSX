import type { PointerSnapshot } from '../../core/types';
import type { RectBounds } from '../../../rompack/rompack';
import { clamp } from '../../../utils/clamp';
import * as constants from '../../core/constants';
import { gotoDiagnostic } from './diagnostics_controller';
import { computeProblemsPanelItemHeight, computeProblemsPanelLayout } from './problems_panel_layout';
import type { ProblemsPanelController } from './problems_panel';
import { editorViewState } from '../../ui/editor_view_state';

export function handleProblemsPanelPointerInput(
	controller: ProblemsPanelController,
	snapshot: PointerSnapshot,
	justPressed: boolean,
	bounds: RectBounds,
): boolean {
	if (!controller.isVisible) {
		return false;
	}
	const layout = computeProblemsPanelLayout(bounds);
	controller.updateCachedLayout(layout);
	const inside =
		snapshot.valid
		&& snapshot.insideViewport
		&& snapshot.viewportX >= bounds.left
		&& snapshot.viewportX < bounds.right
		&& snapshot.viewportY >= bounds.top
		&& snapshot.viewportY < bounds.bottom;
	if (!inside) {
		if (justPressed) {
			controller.setFocused(false);
		}
		if (!snapshot.primaryPressed) {
			controller.setHoverIndex(-1);
		}
		return false;
	}
	if (justPressed) {
		controller.setFocused(true);
	}
	if (snapshot.viewportY < layout.headerBottom) {
		return true;
	}
	const diagnostics = controller.getDiagnostics();
	if (diagnostics.length === 0) {
		controller.setHoverIndex(-1);
		if (justPressed) {
			controller.setSelectionIndex(-1);
		}
		return true;
	}
	const availableWidth = Math.max(0, bounds.right - bounds.left - constants.PROBLEMS_PANEL_CONTENT_PADDING_X * 2);
	const relativeY = snapshot.viewportY - layout.contentTop;
	let itemTop = 0;
	let diagnosticIndex = controller.getScrollIndex();
	while (diagnosticIndex < diagnostics.length) {
		const itemHeight = computeProblemsPanelItemHeight(diagnostics[diagnosticIndex], availableWidth);
		if (relativeY < itemTop + itemHeight) {
			break;
		}
		itemTop += itemHeight;
		diagnosticIndex += 1;
		if (layout.contentTop + itemTop >= layout.contentBottom) {
			break;
		}
	}
	if (diagnosticIndex >= diagnostics.length) {
		controller.setHoverIndex(-1);
		return true;
	}
	controller.setHoverIndex(diagnosticIndex);
	if (!justPressed) {
		return true;
	}
	controller.setSelectionIndex(diagnosticIndex);
	controller.revealSelection(layout, controller.resolvePanelWidth(availableWidth));
	gotoDiagnostic(diagnostics[diagnosticIndex]);
	return true;
}

export function handleProblemsPanelWheelInput(
	controller: ProblemsPanelController,
	direction: number,
	steps: number,
): boolean {
	const layout = controller.getCachedLayout();
	if (!controller.isVisible || !layout) {
		return false;
	}
	const diagnostics = controller.getDiagnostics();
	const panelWidth = controller.resolvePanelWidth();
	let advance = 0;
	let pixels = Math.max(1, steps) * editorViewState.lineHeight;
	let diagnosticIndex = controller.getScrollIndex();
	if (direction > 0) {
		while (diagnosticIndex < diagnostics.length - 1 && pixels > 0) {
			pixels -= Math.max(1, computeProblemsPanelItemHeight(diagnostics[diagnosticIndex], panelWidth));
			diagnosticIndex += 1;
			advance += 1;
		}
	} else if (direction < 0) {
		diagnosticIndex -= 1;
		while (diagnosticIndex >= 0 && pixels > 0) {
			pixels -= Math.max(1, computeProblemsPanelItemHeight(diagnostics[diagnosticIndex], panelWidth));
			diagnosticIndex -= 1;
			advance += 1;
		}
	}
	if (advance === 0) {
		advance = 1;
	}
	const newScroll = clamp(
		controller.getScrollIndex() + (direction > 0 ? advance : -advance),
		0,
		Math.max(0, diagnostics.length - 1),
	);
	if (newScroll === controller.getScrollIndex()) {
		return false;
	}
	controller.setScrollIndex(newScroll);
	return true;
}
