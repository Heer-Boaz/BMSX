import { point_in_rect } from '../../../utils/rect_operations';
import { processInlineFieldPointer } from '../../contrib/find/editor_search';
import { getCreateResourceBarBounds } from '../../ui/editor_view';
import { ide_state } from '../../core/ide_state';
import type { PointerSnapshot } from '../../core/types';
import { activateQuickInputField, finishQuickInputPointer, quickInputTextLeft } from './editor_quick_input_pointer_common';

export function handleCreateResourcePointer(snapshot: PointerSnapshot, justPressed: boolean): boolean {
	const bounds = getCreateResourceBarBounds();
	if (!ide_state.createResource.visible || !bounds) {
		return false;
	}
	const insideBar = point_in_rect(snapshot.viewportX, snapshot.viewportY, bounds);
	if (!insideBar) {
		if (justPressed) {
			ide_state.createResource.active = false;
		}
		return false;
	}
	if (justPressed) {
		ide_state.createResource.active = true;
		activateQuickInputField();
	}
	processInlineFieldPointer(ide_state.createResource.field, quickInputTextLeft('NEW FILE:'), snapshot.viewportX, justPressed, snapshot.primaryPressed);
	finishQuickInputPointer(snapshot);
	return true;
}
