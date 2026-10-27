import type { RectBounds } from '../../../machine/ts/common/rect';

export function writeCenteredDialogBounds(out: RectBounds, area: Readonly<RectBounds>, dialogWidth: number, dialogHeight: number, margin: number): void {
	const centeredLeft = area.left + ((area.right - area.left - dialogWidth) >> 1);
	const centeredTop = area.top + ((area.bottom - area.top - dialogHeight) >> 1);
	const left = Math.max(area.left + margin, centeredLeft);
	const top = Math.max(area.top + margin, centeredTop);
	out.left = left;
	out.top = top;
	out.right = left + dialogWidth;
	out.bottom = top + dialogHeight;
}
