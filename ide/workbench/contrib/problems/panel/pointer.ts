import { PointerButton } from '../../../../../hosts/common/input/pointer_event';
import { point_in_rect } from '../../../../../machine/ts/common/rect';
import type { PointerInputSnapshot } from '../../../../common/models';
import { gotoDiagnostic } from '../../code_editor/diagnostics/navigation';
import type { ProblemsPanelController } from './controller';
import type { EditorParts } from '../../../services/editor/editor_parts';

export function handleProblemsPanelPointerInput(
	controller: ProblemsPanelController,
	parts: EditorParts,
	snapshot: PointerInputSnapshot,
): void {
	if (!snapshot.valid || !snapshot.insideViewport || !point_in_rect(snapshot.viewportX, snapshot.viewportY, controller.bounds)) return;
	if (controller.header.handlePointer(snapshot)) { controller.setHoverIndex(-1); return; }
	// A press owns the diagnostic hit in this layout, before focus may reveal or reflow the activity.
	const diagnostics = controller.getDiagnostics(), generation = controller.scope.contextGeneration;
	const selection = controller.selectionRevision, layout = controller.layoutState;
	let diagnosticIndex = -1;
	if (snapshot.viewportY >= layout.contentTop && snapshot.viewportY < layout.contentBottom) {
		const relativeY = snapshot.viewportY - layout.contentTop;
		let itemTop = 0;
		diagnosticIndex = controller.getScrollIndex();
		while (diagnosticIndex < diagnostics.length) {
			const itemHeight = controller.getItemLayout(diagnosticIndex).height;
			if (relativeY < itemTop + itemHeight) break;
			itemTop += itemHeight; diagnosticIndex++;
			if (layout.contentTop + itemTop >= layout.contentBottom) break;
		}
		if (diagnosticIndex >= diagnostics.length) diagnosticIndex = -1;
	}
	const justPressed = (snapshot.justPressedButtons & PointerButton.Primary) !== 0;
	if (justPressed && !controller.focusTarget.focus()) return;
	if (!controller.attached || controller.scope.contextGeneration !== generation || controller.getDiagnostics() !== diagnostics
		|| controller.selectionRevision !== selection) return;
	controller.setHoverIndex(diagnosticIndex);
	if (!justPressed || diagnosticIndex < 0) return;
	controller.setSelectionIndex(diagnosticIndex);
	controller.revealSelection(controller.layoutState, controller.contentWidth);
	gotoDiagnostic(parts, diagnostics[diagnosticIndex]);
}
