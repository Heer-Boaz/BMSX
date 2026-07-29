import { processRuntimeErrorOverlayPointer } from '../../../workbench/contrib/code_editor/input/overlays/runtime_error/input';
import type { PointerSnapshot } from '../../../common/models';
import { editorPointerState } from '../state';
import type { CartEditor } from '../../../cart_editor';
import type { Runtime } from '../../../../machine/ts/machine/runtime/runtime';
import type { ClipboardService } from '../../../../machine/ts/platform/platform';

export function handleCodeAreaPointerGuards(
	clipboard: ClipboardService,
	editor: CartEditor,
	runtime: Runtime,
	snapshot: PointerSnapshot,
	justPressed: boolean,
	codeTop: number,
	codeRight: number,
	textLeft: number,
	contentBottom: number
): boolean {
	if (!processRuntimeErrorOverlayPointer(
		clipboard,
		editor,
		runtime,
		snapshot,
		justPressed,
		codeTop,
		codeRight,
		textLeft,
		contentBottom,
	)) {
		return false;
	}
	editorPointerState.pointerPrimaryWasPressed = snapshot.primaryPressed;
	return true;
}
