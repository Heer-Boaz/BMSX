import type { RuntimeSourceState } from '../../../runtime/sources';
import type { PointerInputSnapshot } from '../../../common/models';
import * as constants from '../../../common/constants';
import { getCodeAreaBounds } from '../../../editor/ui/view/view';
import { editorViewState } from '../../../editor/ui/view/state';
import { processRuntimeErrorOverlayPointer } from '../../../workbench/contrib/code_editor/input/overlays/runtime_error/input';
import { handleCodeAreaPrimaryPressPointer } from './primary_press';
import { handleCodeAreaGutterPointer, handleCodeAreaSecondaryPointer } from './secondary_actions';
import { codeAreaHover } from './feedback';
import { pointerHover } from '../hover';
import { handleCodeAreaSelectionPointer } from './selection';
import type { CartEditor } from '../../../cart_editor';
import type { Clipboard } from '../../../../hosts/common/clipboard';

export function handleCodeAreaPointerInput(
	editor: CartEditor,
	sources: RuntimeSourceState,
	snapshot: PointerInputSnapshot,
	justPressed: boolean,
	gotoModifierActive: boolean,
	pointerSecondaryJustPressed: boolean,
	now: number,
	clipboard: Clipboard,
): void {
	const bounds = getCodeAreaBounds();
	const contentBottom = editorViewState.codeHorizontalScrollbarVisible
		? bounds.codeBottom - constants.SCROLLBAR_WIDTH
		: bounds.codeBottom;
	if (processRuntimeErrorOverlayPointer(
		clipboard,
		editor,
		snapshot,
		justPressed,
		bounds.codeTop,
		bounds.codeRight,
		bounds.textLeft,
		contentBottom,
	)) {
		return;
	}
	const insideCodeArea = snapshot.viewportY >= bounds.codeTop
		&& snapshot.viewportY < bounds.codeBottom
		&& snapshot.viewportX >= bounds.codeLeft
		&& snapshot.viewportX < bounds.codeRight;
	const inGutter = insideCodeArea
		&& snapshot.viewportX >= bounds.gutterLeft
		&& snapshot.viewportX < bounds.gutterRight;
	if (handleCodeAreaSecondaryPointer(editor, snapshot, insideCodeArea, inGutter, pointerSecondaryJustPressed)) {
		return;
	}
	if (handleCodeAreaGutterPointer(editor.breakpoints, snapshot, justPressed, inGutter, bounds)) {
		return;
	}
	if (handleCodeAreaPrimaryPressPointer(
		editor,
		sources,
		snapshot,
		justPressed,
		insideCodeArea,
		gotoModifierActive,
		bounds,
		now,
	)) {
		return;
	}
	handleCodeAreaSelectionPointer(snapshot, bounds);
	if (snapshot.valid && snapshot.insideViewport && insideCodeArea) pointerHover.visit(codeAreaHover);
	else pointerHover.release(codeAreaHover);
}
