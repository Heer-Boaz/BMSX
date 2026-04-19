import type { RectBounds } from '../../../rompack/format';
import { editorViewState } from '../ui/view/state';

export function writeCenteredDialogBounds(out: RectBounds, dialogWidth: number, dialogHeight: number, margin: number): void {
	const left = Math.max(margin, Math.trunc((editorViewState.viewportWidth - dialogWidth) / 2));
	const top = Math.max(margin, Math.trunc((editorViewState.viewportHeight - dialogHeight) / 2));
	out.left = left;
	out.top = top;
	out.right = left + dialogWidth;
	out.bottom = top + dialogHeight;
}
