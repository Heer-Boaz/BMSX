import { processRuntimeErrorOverlayPointer } from '../../../workbench/contrib/code_editor/input/overlays/runtime_error/input';
import type { PointerSnapshot } from '../../../common/models';
import { editorPointerState } from '../state';
import type { CartEditor } from '../../../cart_editor';
import type { Clipboard } from '../../../common/clipboard';

export function handleCodeAreaPointerGuards(
	clipboard: Clipboard,
	editor: CartEditor,
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
