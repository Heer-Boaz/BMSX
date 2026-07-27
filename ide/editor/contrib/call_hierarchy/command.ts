import * as constants from '../../../common/constants';
import { showEditorMessage } from '../../../common/feedback_state';
import { showCallHierarchyView } from './panel';
import { resolveCallHierarchyViewAt } from './query';
import type { RuntimeLuaTooling } from '../../../runtime/lua_tooling';
import type { ResourcePanelController } from '../../../workbench/contrib/resources/panel/controller';

export function executeEditorCallHierarchyAt(
	bridge: RuntimeLuaTooling,
	resourcePanel: ResourcePanelController,
	row: number,
	column: number,
): void {
	const result = resolveCallHierarchyViewAt(bridge, row, column);
	switch (result.kind) {
		case 'missing_definition':
			showEditorMessage('Definition not found at cursor', constants.COLOR_STATUS_WARNING, 1.8);
			return;
		case 'no_calls':
			showEditorMessage(`No calls found for ${result.expression}`, constants.COLOR_STATUS_WARNING, 1.8);
			return;
		case 'success':
			showCallHierarchyView(resourcePanel, result.view);
			showEditorMessage(result.view.title, constants.COLOR_STATUS_SUCCESS, 1.6);
			return;
	}
}
