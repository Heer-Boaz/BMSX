import { processRuntimeErrorOverlayPointer } from '../overlays/runtime_error/input';
import type { PointerSnapshot } from '../../../common/models';
import { editorPointerState } from './state';

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
