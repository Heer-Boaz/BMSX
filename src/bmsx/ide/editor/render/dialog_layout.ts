import type { RectBounds } from '../../../rompack/rompack';
import { editorViewState } from '../ui/editor_view_state';

export function centerDialogBounds(dialogWidth: number, dialogHeight: number, margin: number): RectBounds {
	const left = Math.max(margin, Math.trunc((editorViewState.viewportWidth - dialogWidth) / 2));
	const top = Math.max(margin, Math.trunc((editorViewState.viewportHeight - dialogHeight) / 2));
	return {
		left,
		top,
		right: left + dialogWidth,
		bottom: top + dialogHeight,
	};
}
