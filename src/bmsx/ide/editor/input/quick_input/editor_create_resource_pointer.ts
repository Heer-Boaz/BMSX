import { point_in_rect } from '../../../../utils/rect_operations';
import { processInlineFieldPointer } from '../../contrib/find/editor_search';
import { getCreateResourceBarBounds } from '../../ui/editor_view';
import type { PointerSnapshot } from '../../../common/types';
import { activateQuickInputField, finishQuickInputPointer, quickInputTextLeft } from './editor_quick_input_pointer_common';
import { editorFeatureState } from '../../common/editor_feature_state';

export function handleCreateResourcePointer(snapshot: PointerSnapshot, justPressed: boolean): boolean {
	const bounds = getCreateResourceBarBounds();
	if (!editorFeatureState.createResource.visible || !bounds) {
		return false;
	}
	const insideBar = point_in_rect(snapshot.viewportX, snapshot.viewportY, bounds);
	if (!insideBar) {
		if (justPressed) {
			editorFeatureState.createResource.active = false;
		}
		return false;
	}
	if (justPressed) {
		editorFeatureState.createResource.active = true;
		activateQuickInputField();
	}
	processInlineFieldPointer(editorFeatureState.createResource.field, quickInputTextLeft('NEW FILE:'), snapshot.viewportX, justPressed, snapshot.primaryPressed);
	finishQuickInputPointer(snapshot);
	return true;
}
