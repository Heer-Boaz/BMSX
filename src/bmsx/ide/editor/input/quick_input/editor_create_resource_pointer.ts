import { point_in_rect } from '../../../../utils/rect_operations';
import { processInlineFieldPointer } from '../../contrib/find/editor_search';
import { getCreateResourceBarBounds } from '../../ui/editor_view';
import type { PointerSnapshot } from '../../../common/types';
import { activateQuickInputField, finishQuickInputPointer, quickInputTextLeft } from './editor_quick_input_pointer_common';
import { createResourceState } from '../../../workbench/contrib/resources/resource_widget_state';

export function handleCreateResourcePointer(snapshot: PointerSnapshot, justPressed: boolean): boolean {
	const bounds = getCreateResourceBarBounds();
	if (!createResourceState.visible || !bounds) {
		return false;
	}
	const insideBar = point_in_rect(snapshot.viewportX, snapshot.viewportY, bounds);
	if (!insideBar) {
		if (justPressed) {
			createResourceState.active = false;
		}
		return false;
	}
	if (justPressed) {
		createResourceState.active = true;
		activateQuickInputField();
	}
	processInlineFieldPointer(createResourceState.field, quickInputTextLeft('NEW FILE:'), snapshot.viewportX, justPressed, snapshot.primaryPressed);
	finishQuickInputPointer(snapshot);
	return true;
}
