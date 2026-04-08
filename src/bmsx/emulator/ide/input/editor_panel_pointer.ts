import type { PointerSnapshot } from '../types';
import { handleProblemsPanelPointer, handleProblemsPanelResizePointer } from './editor_problems_panel_pointer';
import { handleResourcePanelPointer, handleResourcePanelResizePointer } from './editor_resource_panel_pointer';

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
