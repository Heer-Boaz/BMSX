import { point_in_rect } from '../../../../utils/rect_operations';
import { processInlineFieldPointer } from '../../contrib/find/editor_search';
import { getRenameBarBounds } from '../../ui/editor_view';
import { renameController } from '../../contrib/rename/rename_controller';
import type { PointerSnapshot } from '../../../common/types';
import { activateQuickInputField, finishQuickInputPointer, quickInputTextLeft } from './editor_quick_input_pointer_common';

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
