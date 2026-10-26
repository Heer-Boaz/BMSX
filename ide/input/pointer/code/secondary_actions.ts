import type { BreakpointController } from '../../../workbench/contrib/debugger/controller';
import { resolvePointerRow } from '../../../editor/ui/view/view';
import type { CodeAreaBounds } from '../../../editor/ui/view/view';
import { openCodeContextMenu } from '../../../workbench/contrib/code_editor/context_menu';
import { resolvePointerTextPosition } from '../../../editor/ui/view/view';
import type { CodeEditorPane } from '../../../workbench/contrib/code_editor/editor_pane';
import type { CodeEditorControl } from '../../../editor/ui/code_editor_control';
import type { PointerSnapshot } from '../../../common/models';
import { clearEditorPointerSelectionState } from '../state';

export function handleCodeAreaSecondaryPointer(
	pane: CodeEditorPane,
	snapshot: PointerSnapshot,
	insideCodeArea: boolean,
	inGutter: boolean,
	pointerSecondaryJustPressed: boolean,
): boolean {
	if (!pointerSecondaryJustPressed || !insideCodeArea || inGutter) {
		return false;
	}
	const position = resolvePointerTextPosition(pane.code, snapshot.viewportX, snapshot.viewportY);
	openCodeContextMenu(pane, position.row, position.column, snapshot.viewportX, snapshot.viewportY);
	clearEditorPointerSelectionState(pane.code);
	return true;
}

export function handleCodeAreaGutterPointer(
	code: CodeEditorControl,
	breakpoints: BreakpointController,
	snapshot: PointerSnapshot,
	justPressed: boolean,
	inGutter: boolean,
	bounds: CodeAreaBounds,
): boolean {
	if (!justPressed || !inGutter) {
		return false;
	}
	const targetRow = resolvePointerRow(code, snapshot.viewportY, bounds);
	if (!breakpoints.toggleBreakpointForEditorRow(code, targetRow)) {
		return false;
	}
	clearEditorPointerSelectionState(code);
	return true;
}
