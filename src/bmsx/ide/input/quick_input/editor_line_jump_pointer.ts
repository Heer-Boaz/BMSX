import { point_in_rect } from '../../../utils/rect_operations';
import { closeSearch, processInlineFieldPointer } from '../../contrib/find/editor_search';
import { getLineJumpBarBounds } from '../../ui/editor_view';
import type { PointerSnapshot } from '../../core/types';
import { activateQuickInputField, finishQuickInputPointer, quickInputTextLeft } from './editor_quick_input_pointer_common';
import { editorFeatureState } from '../../core/editor_feature_state';

export function handleLineJumpPointer(snapshot: PointerSnapshot, justPressed: boolean): boolean {
	const bounds = getLineJumpBarBounds();
	if (!editorFeatureState.lineJump.visible || !bounds) {
		return false;
	}
	const insideBar = point_in_rect(snapshot.viewportX, snapshot.viewportY, bounds);
	if (!insideBar) {
		if (justPressed) {
			editorFeatureState.lineJump.active = false;
		}
		return false;
	}
	if (justPressed) {
		closeSearch(false, true);
		editorFeatureState.lineJump.active = true;
		activateQuickInputField();
	}
	processInlineFieldPointer(editorFeatureState.lineJump.field, quickInputTextLeft('LINE #:'), snapshot.viewportX, justPressed, snapshot.primaryPressed);
	finishQuickInputPointer(snapshot);
	return true;
}
