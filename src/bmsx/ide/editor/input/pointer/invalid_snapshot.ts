import { clearHoverTooltip, clearGotoHoverHighlight } from '../../contrib/intellisense/engine';
import type { PointerSnapshot } from '../../../common/models';
import { editorPointerState } from './state';

export function handleInvalidEditorPointerSnapshot(snapshot: PointerSnapshot): boolean {
	if (snapshot.valid) {
		return false;
	}
	editorPointerState.pointerPrimaryWasPressed = snapshot.primaryPressed;
	clearHoverTooltip();
	clearGotoHoverHighlight();
	return true;
}
