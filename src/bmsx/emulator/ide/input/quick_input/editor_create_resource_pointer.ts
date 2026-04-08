import { point_in_rect } from '../../../../utils/rect_operations';
import { processInlineFieldPointer } from '../../editor_search';
import { getCreateResourceBarBounds } from '../../editor_view';
import { ide_state } from '../../ide_state';
import type { PointerSnapshot } from '../../types';
import { activateQuickInputField, finishQuickInputPointer, quickInputTextLeft } from './editor_quick_input_pointer_common';

export function handleCreateResourcePointer(snapshot: PointerSnapshot, justPressed: boolean): boolean {
	const bounds = getCreateResourceBarBounds();
	if (!ide_state.createResourceVisible || !bounds) {
		return false;
	}
	const insideBar = point_in_rect(snapshot.viewportX, snapshot.viewportY, bounds);
	if (!insideBar) {
		if (justPressed) {
			ide_state.createResourceActive = false;
		}
		return false;
	}
	if (justPressed) {
		ide_state.createResourceActive = true;
		activateQuickInputField();
	}
	processInlineFieldPointer(ide_state.createResourceField, quickInputTextLeft('NEW FILE:'), snapshot.viewportX, justPressed, snapshot.primaryPressed);
	finishQuickInputPointer(snapshot);
	return true;
}
