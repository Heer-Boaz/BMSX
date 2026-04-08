import { ide_state } from '../../core/ide_state';
import { clearHoverTooltip, clearGotoHoverHighlight } from '../../contrib/intellisense/intellisense';
import type { PointerSnapshot } from '../../core/types';

export function handleInvalidEditorPointerSnapshot(snapshot: PointerSnapshot): boolean {
	if (snapshot.valid) {
		return false;
	}
	ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
	clearHoverTooltip();
	clearGotoHoverHighlight();
	return true;
}
