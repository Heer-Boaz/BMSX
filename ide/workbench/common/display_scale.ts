/** Preference percentages multiply the workbench's logical pixel size, not device DPR. */
export const WORKSPACE_UI_SCALES = [0.75, 1, 1.25, 1.5, 2] as const;
export type WorkspaceUiScale = typeof WORKSPACE_UI_SCALES[number];

/** Compact widths preserve the original 384-unit working width at 100%.
 * Desktop space grows beyond it at a readable bitmap-font size. Height never
 * changes UI density: opening a keyboard or shortening a window only removes rows. */
export function workbenchPixelsPerUnit(availableWidth: number, uiScale: WorkspaceUiScale): number {
	return Math.min(3, availableWidth / 384) * uiScale;
}
