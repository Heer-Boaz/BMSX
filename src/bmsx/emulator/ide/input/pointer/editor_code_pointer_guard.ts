import { ide_state } from '../../core/ide_state';
import { processRuntimeErrorOverlayPointer } from '../overlays/runtime_error_overlay_input';
import type { PointerSnapshot } from '../../core/types';

export function handleCodeAreaPointerGuards(
	snapshot: PointerSnapshot,
	justPressed: boolean,
	codeTop: number,
	codeRight: number,
	textLeft: number
): boolean {
	if (!processRuntimeErrorOverlayPointer(snapshot, justPressed, codeTop, codeRight, textLeft)) {
		return false;
	}
	ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
	return true;
}
