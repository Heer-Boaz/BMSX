import { point_in_rect } from '../../../../../common/rect';
import { processInlineFieldPointer } from '../../../contrib/find/search';
import { getCreateResourceBarBounds } from '../../../ui/view';
import type { PointerSnapshot } from '../../../../common/models';
import { activateQuickInputField, finishQuickInputPointer, quickInputTextLeft } from '../pointer/common';
import { createResourceState } from '../../../../workbench/contrib/resources/widget_state';

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
