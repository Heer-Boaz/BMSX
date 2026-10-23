import type { RectBounds } from '../../../machine/ts/common/rect';
import { COLOR_SURFACE_SHADOW } from '../../common/constants';
import { api } from '../../runtime/overlay_api';

/** Floating surfaces share one depth cue. Shadow pixels never enlarge their input bounds. */
export function drawWorkbenchSurfaceShadow(bounds: Readonly<RectBounds>): void {
	api.fill_rect(bounds.left + 2, bounds.top + 2, bounds.right + 2, bounds.bottom + 2, 0, COLOR_SURFACE_SHADOW);
}
