import { getWorkbenchConnectionBounds } from '../../workbench/common/layout';
import { point_in_rect } from '../../../machine/ts/common/rect';
import type { CartEditor } from '../../cart_editor';
import type { PointerSnapshot } from '../../common/models';


export function handleEditorChromePointerDispatch(
	editor: CartEditor,
	snapshot: PointerSnapshot,
	justPressed: boolean,
): boolean {
	if (editor.runtimeTimeline.handlePointer(snapshot)) {
		return true;
	}
	if (editor.gamePanel.handlePointer(snapshot)) {
		return true;
	}
	if (!snapshot.valid) return true;
	if (point_in_rect(snapshot.viewportX, snapshot.viewportY, getWorkbenchConnectionBounds())) {
		if (justPressed) editor.commands.execute('server.connection');
		return true;
	}
	return false;
}
