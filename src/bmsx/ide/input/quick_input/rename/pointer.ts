import { point_in_rect } from '../../../../common/rect';
import { processInlineFieldPointer } from '../../../editor/contrib/find/search';
import { getRenameBarBounds } from '../../../editor/ui/view/view';
import { renameController } from '../../../editor/contrib/rename/controller';
import type { PointerSnapshot } from '../../../common/models';
import { activateQuickInputField, finishQuickInputPointer, quickInputTextLeft } from '../pointer/common';
import type { ResourcePanelController } from '../../../workbench/contrib/resources/panel/controller';

export function handleRenamePointer(resourcePanel: ResourcePanelController, snapshot: PointerSnapshot, justPressed: boolean): boolean {
	const bounds = getRenameBarBounds();
	if (!renameController.isVisible() || !bounds) {
		return false;
	}
	const insideBar = point_in_rect(snapshot.viewportX, snapshot.viewportY, bounds);
	if (!insideBar) {
		if (justPressed) {
			renameController.cancel();
		}
		return false;
	}
	if (justPressed) {
		activateQuickInputField(resourcePanel);
	}
	processInlineFieldPointer(renameController.getField(), quickInputTextLeft('RENAME:'), snapshot.viewportX, justPressed, snapshot.primaryPressed);
	finishQuickInputPointer(snapshot);
	return true;
}
