import { processRuntimeErrorOverlayPointer } from '../overlays/runtime_error_overlay_input';
import type { PointerSnapshot } from '../../core/types';
import { editorPointerState } from './editor_pointer_state';

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
	editorPointerState.pointerPrimaryWasPressed = snapshot.primaryPressed;
	return true;
}
