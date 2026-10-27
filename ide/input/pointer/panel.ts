import type { PointerSnapshot } from '../../common/models';
import { handleProblemsPanelPointer } from './problems_panel';
import { handleResourcePanelPointer } from './resource_panel_content';
import type { ResourcePanelController } from '../../workbench/contrib/resources/panel/controller';
import type { EditorParts } from '../../workbench/services/editor/editor_parts';

export function handleEditorPanelPointer(
	resourcePanel: ResourcePanelController,
	parts: EditorParts,
	snapshot: PointerSnapshot,
	justPressed: boolean,
	justReleased: boolean,
): boolean {
	if (handleResourcePanelPointer(resourcePanel, snapshot, justPressed)) {
		return true;
	}
	return handleProblemsPanelPointer(parts, snapshot, justPressed, justReleased);
}
