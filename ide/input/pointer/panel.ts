import type { PointerSnapshot } from '../../common/models';
import { handleProblemsPanelPointer, handleProblemsPanelResizePointer } from './problems_panel';
import { handleResourcePanelPointer } from './resource_panel_content';
import { handleResourcePanelResizePointer } from './resource_panel_resize';
import type { ResourcePanelController } from '../../workbench/contrib/resources/panel/controller';

export function handleEditorPanelResizePointer(resourcePanel: ResourcePanelController, snapshot: PointerSnapshot, justPressed: boolean): boolean {
	if (handleResourcePanelResizePointer(resourcePanel, snapshot, justPressed)) {
		return true;
	}
	return handleProblemsPanelResizePointer(snapshot, justPressed);
}

export function handleEditorPanelPointer(snapshot: PointerSnapshot, justPressed: boolean, justReleased: boolean): boolean {
	if (handleResourcePanelPointer(snapshot, justPressed)) {
		return true;
	}
	return handleProblemsPanelPointer(snapshot, justPressed, justReleased);
}
