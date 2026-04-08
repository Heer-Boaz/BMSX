import { point_in_rect } from '../../../../utils/rect_operations';
import { processInlineFieldPointer } from '../../editor_search';
import { getRenameBarBounds } from '../../editor_view';
import { ide_state } from '../../ide_state';
import type { PointerSnapshot } from '../../types';
import { activateQuickInputField, finishQuickInputPointer, quickInputTextLeft } from './editor_quick_input_pointer_common';

export function handleRenamePointer(snapshot: PointerSnapshot, justPressed: boolean): boolean {
	const bounds = getRenameBarBounds();
	if (!ide_state.renameController.isVisible() || !bounds) {
		return false;
	}
	const insideBar = point_in_rect(snapshot.viewportX, snapshot.viewportY, bounds);
	if (!insideBar) {
		if (justPressed) {
			ide_state.renameController.cancel();
		}
		return false;
	}
	if (justPressed) {
		activateQuickInputField();
	}
	processInlineFieldPointer(ide_state.renameController.getField(), quickInputTextLeft('RENAME:'), snapshot.viewportX, justPressed, snapshot.primaryPressed);
	finishQuickInputPointer(snapshot);
	return true;
}
