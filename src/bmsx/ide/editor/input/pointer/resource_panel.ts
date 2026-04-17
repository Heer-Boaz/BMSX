import type { PointerSnapshot } from '../../../common/models';
import { handleResourcePanelPointer as handleResourcePanelContentPointer } from '../../../workbench/input/pointer/resource_panel/content';
import { handleResourcePanelResizePointer as handleResourcePanelResizeInteraction } from '../../../workbench/input/pointer/resource_panel/resize';

export function handleResourcePanelResizePointer(snapshot: PointerSnapshot, justPressed: boolean): boolean {
	return handleResourcePanelResizeInteraction(snapshot, justPressed);
}

export function handleResourcePanelPointer(snapshot: PointerSnapshot, justPressed: boolean): boolean {
	return handleResourcePanelContentPointer(snapshot, justPressed);
}
