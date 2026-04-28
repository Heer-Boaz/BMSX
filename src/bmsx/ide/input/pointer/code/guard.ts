import { processRuntimeErrorOverlayPointer } from '../../../editor/input/overlays/runtime_error/input';
import type { PointerSnapshot } from '../../../common/models';
import { editorPointerState } from '../state';
import type { Runtime } from '../../../../machine/runtime/runtime';

export function handleCodeAreaPointerGuards(
	runtime: Runtime,
	snapshot: PointerSnapshot,
	justPressed: boolean,
	codeTop: number,
	codeRight: number,
	textLeft: number,
	contentBottom: number
): boolean {
	if (!processRuntimeErrorOverlayPointer(runtime, snapshot, justPressed, codeTop, codeRight, textLeft, contentBottom)) {
		return false;
	}
	editorPointerState.pointerPrimaryWasPressed = snapshot.primaryPressed;
	return true;
}
