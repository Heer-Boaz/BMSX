import * as constants from './constants';
import { ide_state } from './ide_state';
import { showCallHierarchyView } from './call_hierarchy_panel';
import { resolveCallHierarchyViewAt } from './call_hierarchy_query';

export function executeEditorCallHierarchyAt(row: number, column: number): void {
	const result = resolveCallHierarchyViewAt(row, column);
	switch (result.kind) {
		case 'missing_definition':
			ide_state.showMessage('Definition not found at cursor', constants.COLOR_STATUS_WARNING, 1.8);
			return;
		case 'no_calls':
			ide_state.showMessage(`No calls found for ${result.expression}`, constants.COLOR_STATUS_WARNING, 1.8);
			return;
		case 'success':
			showCallHierarchyView(result.view);
			ide_state.showMessage(result.view.title, constants.COLOR_STATUS_SUCCESS, 1.6);
			return;
	}
}
