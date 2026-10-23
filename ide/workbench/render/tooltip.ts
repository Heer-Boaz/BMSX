import type { RectBounds } from '../../../machine/ts/common/rect';
import type { BFont } from '../../../machine/ts/render/shared/bitmap_font';
import * as colors from '../../common/constants';
import { api } from '../../runtime/overlay_api';
import { drawWorkbenchSurfaceShadow } from './surface';

/** Passive surface feedback is painted after controls and never participates in hit testing. */
export function drawWorkbenchTooltip(lines: readonly string[], visibleLines: number, bounds: Readonly<RectBounds>, font: BFont): void {
	drawWorkbenchSurfaceShadow(bounds);
	api.fill_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, 0, colors.HOVER_TOOLTIP_BACKGROUND);
	api.blit_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, 0, colors.HOVER_TOOLTIP_BORDER);
	api.pushClipRect(bounds.left + 1, bounds.top + 1, bounds.right - 1, bounds.bottom - 1);
	for (let index = 0; index < visibleLines; index++) {
		api.blit_text_inline_with_font(lines[index], bounds.left + 4, bounds.top + 3 + index * font.lineHeight, 0, colors.HOVER_TOOLTIP_TEXT, font);
	}
	api.popClipRect();
}
