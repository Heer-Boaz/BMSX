import * as constants from '../../../common/constants';
import { showEditorMessage } from '../../../workbench/common/feedback_state';
import { showCallHierarchyView } from './panel';
import { resolveCallHierarchyViewAt } from './query';

export function executeEditorCallHierarchyAt(row: number, column: number): void {
	const result = resolveCallHierarchyViewAt(row, column);
	switch (result.kind) {
		case 'missing_definition':
			showEditorMessage('Definition not found at cursor', constants.COLOR_STATUS_WARNING, 1.8);
			return;
		case 'no_calls':
			showEditorMessage(`No calls found for ${result.expression}`, constants.COLOR_STATUS_WARNING, 1.8);
			return;
		case 'success':
			showCallHierarchyView(result.view);
			showEditorMessage(result.view.title, constants.COLOR_STATUS_SUCCESS, 1.6);
			return;
	}
}
