import { PointerButton } from '../../../../../hosts/common/input/pointer_event';
import type { PointerSnapshot } from '../../../../common/models';
import type { RectBounds } from '../../../../../machine/ts/common/rect';
import { gotoDiagnostic } from '../../code_editor/diagnostics/navigation';
import type { ProblemsPanelController } from './controller';
import type { EditorGroupView } from '../../../services/editor/editor_group';

export function handleProblemsPanelPointerInput(
	controller: ProblemsPanelController,
	editorGroup: EditorGroupView,
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
		if ((snapshot.pressedButtons & PointerButton.Primary) === 0) {
			controller.setHoverIndex(-1);
		}
		return false;
	}
	if (controller.header.handlePointer(snapshot)) { controller.setHoverIndex(-1); return true; }
	if (justPressed) {
		controller.setFocused(true);
	}
	if (snapshot.viewportY < layout.contentTop || snapshot.viewportY >= layout.contentBottom) {
		controller.setHoverIndex(-1);
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
	gotoDiagnostic(editorGroup, diagnostics[diagnosticIndex]);
	return true;
}
