import type { PointerSnapshot } from '../../../common/types';
import { handleResourcePanelPointer as handleResourcePanelContentPointer } from '../../../workbench/input/pointer/resource_panel_content_pointer';
import { handleResourcePanelResizePointer as handleResourcePanelResizeInteraction } from '../../../workbench/input/pointer/resource_panel_resize_pointer';

export function handleResourcePanelResizePointer(snapshot: PointerSnapshot, justPressed: boolean): boolean {
	return handleResourcePanelResizeInteraction(snapshot, justPressed);
}

export function handleResourcePanelPointer(snapshot: PointerSnapshot, justPressed: boolean): boolean {
	return handleResourcePanelContentPointer(snapshot, justPressed);
}
