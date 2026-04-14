import { clearHoverTooltip, clearGotoHoverHighlight } from '../../contrib/intellisense/intellisense';
import type { PointerSnapshot } from '../../../common/types';
import { editorPointerState } from './editor_pointer_state';

export function handleInvalidEditorPointerSnapshot(snapshot: PointerSnapshot): boolean {
	if (snapshot.valid) {
		return false;
	}
	editorPointerState.pointerPrimaryWasPressed = snapshot.primaryPressed;
	clearHoverTooltip();
	clearGotoHoverHighlight();
	return true;
}
