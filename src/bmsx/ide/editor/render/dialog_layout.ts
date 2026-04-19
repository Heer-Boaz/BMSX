import type { RectBounds } from '../../../rompack/format';
import { editorViewState } from '../ui/view/state';

export function writeCenteredDialogBounds(out: RectBounds, dialogWidth: number, dialogHeight: number, margin: number): void {
	const centeredLeft = (editorViewState.viewportWidth - dialogWidth) >> 1;
	const centeredTop = (editorViewState.viewportHeight - dialogHeight) >> 1;
	const left = centeredLeft < margin ? margin : centeredLeft;
	const top = centeredTop < margin ? margin : centeredTop;
	out.left = left;
	out.top = top;
	out.right = left + dialogWidth;
	out.bottom = top + dialogHeight;
}
