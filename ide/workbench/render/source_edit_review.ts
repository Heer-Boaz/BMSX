import * as colors from '../../common/constants';
import { api } from '../../runtime/overlay_api';
import type { WorkbenchSourceEditReview } from '../ui/source_edit_review/control';
import { renderWorkbenchActionBar } from './action_bar';
import { drawWorkbenchPropertyTree } from './property_tree';

export function drawWorkbenchSourceEditReview(review: WorkbenchSourceEditReview): void {
	const { bounds, font } = review;
	api.fill_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, 0, colors.COLOR_RESOURCE_VIEWER_BACKGROUND);
	renderWorkbenchActionBar(review.actionBar, review, font!);
	api.blit_text_inline_with_font(review.title, bounds.left + 4, bounds.top + 3, 0, colors.COLOR_RESOURCE_VIEWER_TEXT, font!);
	api.blit_text_inline_with_font(review.summary, bounds.left + 4, bounds.top + font!.lineHeight + 7, 0, colors.COLOR_RESOURCE_VIEWER_TEXT, font!);
	drawWorkbenchPropertyTree(review.tree);
}
