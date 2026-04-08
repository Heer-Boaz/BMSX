import { ide_state } from '../../ide_state';
import { clearHoverTooltip, clearGotoHoverHighlight } from '../../intellisense';
import type { PointerSnapshot } from '../../types';

export function handleInvalidEditorPointerSnapshot(snapshot: PointerSnapshot): boolean {
	if (snapshot.valid) {
		return false;
	}
	ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
	clearHoverTooltip();
	clearGotoHoverHighlight();
	return true;
}
