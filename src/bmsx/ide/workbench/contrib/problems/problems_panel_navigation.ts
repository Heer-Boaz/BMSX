import { clamp } from '../../../../common/clamp';
import { gotoDiagnostic } from '../../../editor/contrib/diagnostics/diagnostic_navigation';
import { estimateProblemsPanelVisibleCount } from './problems_panel_layout';
import type { ProblemsPanelController } from './problems_panel';

export type ProblemsPanelCommand = 'up' | 'down' | 'page-up' | 'page-down' | 'home' | 'end' | 'activate';

export function handleProblemsPanelNavigationCommand(controller: ProblemsPanelController, command: ProblemsPanelCommand): boolean {
	if (!controller.isVisible || !controller.isFocused) {
		return false;
	}
	const layout = controller.getCachedLayout();
	if (!layout) {
		return false;
	}
	const diagnostics = controller.getDiagnostics();
	switch (command) {
		case 'activate': {
			const diagnostic = controller.selectedDiagnostic;
			if (!diagnostic) {
				return false;
			}
			gotoDiagnostic(diagnostic);
			return true;
		}
		case 'home':
			if (diagnostics.length === 0 || controller.getSelectionIndex() === 0) {
				return false;
			}
			controller.setSelectionIndex(0);
			controller.revealSelection(layout, controller.resolvePanelWidth());
			return true;
		case 'end': {
			if (diagnostics.length === 0) {
				return false;
			}
			const lastIndex = diagnostics.length - 1;
			if (controller.getSelectionIndex() === lastIndex) {
				return false;
			}
			controller.setSelectionIndex(lastIndex);
			controller.revealSelection(layout, controller.resolvePanelWidth());
			return true;
		}
		case 'page-up':
		case 'page-down': {
			if (diagnostics.length === 0) {
				return false;
			}
			const step = Math.max(1, estimateProblemsPanelVisibleCount(diagnostics, controller.getScrollIndex(), layout, controller.resolvePanelWidth()));
			const delta = command === 'page-up' ? -step : step;
			const selectionIndex = controller.getSelectionIndex();
			const nextIndex = clamp(
				selectionIndex === -1 ? (delta > 0 ? 0 : diagnostics.length - 1) : selectionIndex + delta,
				0,
				diagnostics.length - 1,
			);
			if (nextIndex === selectionIndex) {
				return false;
			}
			controller.setSelectionIndex(nextIndex);
			controller.revealSelection(layout, controller.resolvePanelWidth());
			return true;
		}
		case 'up':
		case 'down': {
			if (diagnostics.length === 0) {
				return false;
			}
			const delta = command === 'up' ? -1 : 1;
			const selectionIndex = controller.getSelectionIndex();
			const baseIndex = selectionIndex === -1 ? (delta > 0 ? -1 : diagnostics.length) : selectionIndex;
			const nextIndex = clamp(baseIndex + delta, 0, diagnostics.length - 1);
			if (nextIndex === selectionIndex) {
				return false;
			}
			controller.setSelectionIndex(nextIndex);
			controller.revealSelection(layout, controller.resolvePanelWidth());
			return true;
		}
	}
}
