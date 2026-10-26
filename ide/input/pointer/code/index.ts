import type { PointerInputSnapshot } from '../../../common/models';
import type { CodeEditorPane } from '../../../workbench/contrib/code_editor/editor_pane';
import * as constants from '../../../common/constants';
import { getCodeAreaBounds } from '../../../editor/ui/view/view';
import { processRuntimeErrorOverlayPointer } from '../../../workbench/contrib/code_editor/input/overlays/runtime_error/input';
import { handleCodeAreaPrimaryPressPointer } from './primary_press';
import { handleCodeAreaGutterPointer, handleCodeAreaSecondaryPointer } from './secondary_actions';
import { pointerHover } from '../hover';

export function handleCodeAreaPointerInput(pane: CodeEditorPane, snapshot: PointerInputSnapshot,
	justPressed: boolean, goto: boolean, secondary: boolean, now: number): void {
	const code = pane.code, bounds = getCodeAreaBounds(code);
	const contentBottom = code.geometry.codeHorizontalScrollbarVisible ? bounds.codeBottom - constants.SCROLLBAR_WIDTH : bounds.codeBottom;
	if (processRuntimeErrorOverlayPointer(pane, snapshot, justPressed, bounds.codeTop, bounds.codeRight, bounds.textLeft, contentBottom)) return;
	const inside = snapshot.viewportY >= bounds.codeTop && snapshot.viewportY < bounds.codeBottom
		&& snapshot.viewportX >= bounds.codeLeft && snapshot.viewportX < bounds.codeRight;
	const inGutter = inside && snapshot.viewportX >= bounds.gutterLeft && snapshot.viewportX < bounds.gutterRight;
	if (handleCodeAreaSecondaryPointer(pane, snapshot, inside, inGutter, secondary)) return;
	if (handleCodeAreaGutterPointer(code, pane.editor.breakpoints, snapshot, justPressed, inGutter, bounds)) return;
	if (snapshot.valid && snapshot.insideViewport && inside) pointerHover.visit(pane.codeHover);
	else pointerHover.release(pane.codeHover);
	handleCodeAreaPrimaryPressPointer(pane, snapshot, justPressed, inside, goto, bounds, now);
}
