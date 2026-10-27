import type { PointerSnapshot } from '../../common/models';
import { handleProblemsPanelPointer } from './problems_panel';
import { handleResourcePanelPointer } from './resource_panel_content';
import type { ResourcePanelController } from '../../workbench/contrib/resources/panel/controller';
import type { EditorGroupView } from '../../workbench/services/editor/editor_group';

export function handleEditorPanelPointer(
	resourcePanel: ResourcePanelController,
	editorGroup: EditorGroupView,
	snapshot: PointerSnapshot,
	justPressed: boolean,
	justReleased: boolean,
): boolean {
	if (handleResourcePanelPointer(resourcePanel, snapshot, justPressed)) {
		return true;
	}
	return handleProblemsPanelPointer(editorGroup, snapshot, justPressed, justReleased);
}
