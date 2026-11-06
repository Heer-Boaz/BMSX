/** Logical canvas units are independent of host CSS pixels and device DPR. */
export const WORKBENCH_PIXELS_PER_UNIT = 3;

/** Compact widths retain the canvas coordinate budget; font sizes are resolved
 * against this density so narrowing the window does not shrink the text. */
export function workbenchPixelsPerUnit(availableWidth: number): number {
	return Math.min(WORKBENCH_PIXELS_PER_UNIT, availableWidth / 384);
}
