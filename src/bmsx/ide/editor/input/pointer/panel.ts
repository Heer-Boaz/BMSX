import type { PointerSnapshot } from '../../../common/models';
import { handleProblemsPanelPointer, handleProblemsPanelResizePointer } from '../../../workbench/input/pointer/problems_panel/pointer';
import { handleResourcePanelPointer, handleResourcePanelResizePointer } from './resource_panel';

export function handleEditorPanelResizePointer(snapshot: PointerSnapshot, justPressed: boolean): boolean {
	if (handleResourcePanelResizePointer(snapshot, justPressed)) {
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
