import { point_in_rect } from '../../../../../common/rect';
import { processInlineFieldPointer } from '../../../contrib/find/search';
import { getRenameBarBounds } from '../../../ui/view/view';
import { renameController } from '../../../contrib/rename/controller';
import type { PointerSnapshot } from '../../../../common/models';
import { activateQuickInputField, finishQuickInputPointer, quickInputTextLeft } from '../pointer/common';

export function handleRenamePointer(snapshot: PointerSnapshot, justPressed: boolean): boolean {
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
		activateQuickInputField();
	}
	processInlineFieldPointer(renameController.getField(), quickInputTextLeft('RENAME:'), snapshot.viewportX, justPressed, snapshot.primaryPressed);
	finishQuickInputPointer(snapshot);
	return true;
}
