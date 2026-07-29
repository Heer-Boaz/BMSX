import { point_in_rect } from '../../../../machine/ts/common/rect';
import { processInlineFieldPointer } from '../../../workbench/contrib/code_editor/find/search';
import { getCreateResourceBarBounds } from '../../../workbench/common/layout';
import type { PointerSnapshot } from '../../../common/models';
import { activateQuickInputField, finishQuickInputPointer, quickInputTextLeft } from '../pointer/common';
import { createResourceState } from '../../../workbench/contrib/resources/widget_state';
import type { ResourcePanelController } from '../../../workbench/contrib/resources/panel/controller';

export function handleCreateResourcePointer(resourcePanel: ResourcePanelController, snapshot: PointerSnapshot, justPressed: boolean): boolean {
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
		activateQuickInputField(resourcePanel);
	}
	processInlineFieldPointer(createResourceState.field, quickInputTextLeft('NEW FILE:'), snapshot.viewportX, justPressed, snapshot.primaryPressed);
	finishQuickInputPointer(snapshot);
	return true;
}
