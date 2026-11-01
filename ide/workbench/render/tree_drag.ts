import { clamp } from '../../../machine/ts/common/clamp';
import type { RectBounds } from '../../../machine/ts/common/rect';
import * as colors from '../../common/constants';
import { api } from '../../runtime/overlay_api';
import type { WorkbenchTreeDragFeedback } from '../ui/tree_drag';

/** Passive work-area feedback; the marker stays clipped to its actual tree viewport. */
export function drawWorkbenchTreeDrag(feedback: WorkbenchTreeDragFeedback<unknown>, area: Readonly<RectBounds>): void {
	const color = feedback.accepted ? colors.COLOR_PROBLEMS_PANEL_SELECTION_BORDER : colors.COLOR_DESCRIPTION_TEXT;
	if (feedback.accepted) {
		const clip = feedback.clip, marker = feedback.marker;
		api.pushClipRect(clip.left, clip.top, clip.right, clip.bottom);
		if (feedback.placement === 'inside') api.blit_rect(marker.left, marker.top, marker.right, marker.bottom, 0, color);
		else {
			api.fill_rect(marker.left, marker.top, marker.right, marker.bottom, 0, color);
			api.fill_rect(marker.left, marker.top - 2, marker.left + 2, marker.bottom + 2, 0, color);
		}
		api.popClipRect();
	}
	const width = Math.min(feedback.labelWidth + 8, area.right - area.left), height = Math.min(feedback.font.lineHeight + 4, area.bottom - area.top);
	const left = clamp(feedback.pointerX + 8, area.left, area.right - width);
	const top = clamp(feedback.pointerY + 8, area.top, area.bottom - height);
	api.fill_rect(left, top, left + width, top + height, 0, colors.COLOR_PROBLEMS_PANEL_HEADER_BACKGROUND);
	api.blit_rect(left, top, left + width, top + height, 0, color);
	api.pushClipRect(left + 2, top + 1, left + width - 2, top + height - 1);
	api.blit_text_inline_with_font(feedback.label, left + 4, top + 2, 0, colors.COLOR_RESOURCE_VIEWER_TEXT, feedback.font);
	api.popClipRect();
}
