import type { PointerSnapshot } from '../../../../common/models';
import type { RectBounds } from '../../../../../rompack/format';
import { clamp } from '../../../../../common/clamp';
import { gotoDiagnostic } from '../../../../editor/contrib/diagnostics/navigation';
import type { ProblemsPanelController } from './controller';
import { editorViewState } from '../../../../editor/ui/view/state';

export function handleProblemsPanelPointerInput(
	controller: ProblemsPanelController,
	snapshot: PointerSnapshot,
	justPressed: boolean,
	bounds: RectBounds,
): boolean {
	if (!controller.isVisible) {
		return false;
	}
	const layout = controller.prepareLayout(bounds);
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
	const availableWidth = controller.resolveAvailableWidth(bounds);
	const relativeY = snapshot.viewportY - layout.contentTop;
	let itemTop = 0;
	let diagnosticIndex = controller.getScrollIndex();
	while (diagnosticIndex < diagnostics.length) {
		const itemHeight = controller.getItemLayout(diagnosticIndex, availableWidth).height;
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
	controller.revealSelection(layout, availableWidth);
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
	let pixels = steps * editorViewState.lineHeight;
	let diagnosticIndex = controller.getScrollIndex();
	if (direction > 0) {
		while (diagnosticIndex < diagnostics.length - 1 && pixels > 0) {
			pixels -= controller.getItemLayout(diagnosticIndex, panelWidth).height;
			diagnosticIndex += 1;
			advance += 1;
		}
	} else if (direction < 0) {
		diagnosticIndex -= 1;
		while (diagnosticIndex >= 0 && pixels > 0) {
			pixels -= controller.getItemLayout(diagnosticIndex, panelWidth).height;
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
		diagnostics.length - 1,
	);
	if (newScroll === controller.getScrollIndex()) {
		return false;
	}
	controller.setScrollIndex(newScroll);
	return true;
}
