import type { PlayerInput } from '../../../../hosts/common/input/player';
import type { BreakpointController } from '../../../workbench/contrib/debugger/controller';
import { resolvePointerRow } from '../../../editor/ui/view/view';
import type { CodeAreaBounds } from '../../../editor/ui/view/view';
import { openCodeContextMenu } from '../../../workbench/contrib/code_editor/context_menu';
import { resolvePointerTextPosition } from '../../../editor/ui/view/view';
import type { CartEditor } from '../../../cart_editor';
import type { PointerSnapshot } from '../../../common/models';
import { clearEditorPointerSelectionState } from '../state';

export function handleCodeAreaSecondaryPointer(
	editor: CartEditor,
	snapshot: PointerSnapshot,
	insideCodeArea: boolean,
	inGutter: boolean,
	pointerSecondaryJustPressed: boolean,
	playerInput: PlayerInput
): boolean {
	if (!pointerSecondaryJustPressed || !insideCodeArea || inGutter) {
		return false;
	}
	const position = resolvePointerTextPosition(snapshot.viewportX, snapshot.viewportY);
	openCodeContextMenu(editor, position.row, position.column, snapshot.viewportX, snapshot.viewportY);
	playerInput.inputHandlers.pointer.consumeButton('pointer_secondary');
	clearEditorPointerSelectionState();
	return true;
}

export function handleCodeAreaGutterPointer(
	breakpoints: BreakpointController,
	snapshot: PointerSnapshot,
	justPressed: boolean,
	inGutter: boolean,
	bounds: CodeAreaBounds,
): boolean {
	if (!justPressed || !inGutter) {
		return false;
	}
	const targetRow = resolvePointerRow(snapshot.viewportY, bounds);
	if (!breakpoints.toggleBreakpointForEditorRow(targetRow)) {
		return false;
	}
	clearEditorPointerSelectionState();
	return true;
}
