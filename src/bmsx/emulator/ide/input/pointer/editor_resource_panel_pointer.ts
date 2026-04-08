import type { PointerSnapshot } from '../../types';
import { handleResourcePanelPointer as handleResourcePanelContentPointer } from './editor_resource_panel_content_pointer';
import { handleResourcePanelResizePointer as handleResourcePanelResizeInteraction } from './editor_resource_panel_resize_pointer';

export function handleResourcePanelResizePointer(snapshot: PointerSnapshot, justPressed: boolean): boolean {
	return handleResourcePanelResizeInteraction(snapshot, justPressed);
}

export function handleResourcePanelPointer(snapshot: PointerSnapshot, justPressed: boolean): boolean {
	return handleResourcePanelContentPointer(snapshot, justPressed);
}
