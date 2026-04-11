import type { RectBounds } from '../../rompack/rompack';
import { ide_state } from '../core/ide_state';

export function centerDialogBounds(dialogWidth: number, dialogHeight: number, margin: number): RectBounds {
	const left = Math.max(margin, Math.trunc((ide_state.viewportWidth - dialogWidth) / 2));
	const top = Math.max(margin, Math.trunc((ide_state.viewportHeight - dialogHeight) / 2));
	return {
		left,
		top,
		right: left + dialogWidth,
		bottom: top + dialogHeight,
	};
}
