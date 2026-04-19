import { $ } from '../../../../../core/engine';
import type { RectBounds } from '../../../../../rompack/format';
import { clamp } from '../../../../../common/clamp';
import * as constants from '../../../../common/constants';
import { codeViewportTop } from '../../../../editor/ui/view/view';
import { bottomMargin } from '../../../common/layout';
import { editorViewState } from '../../../../editor/ui/view/state';

export function defaultResourcePanelRatio(): number {
	const metrics = $.platform.gameviewHost.getCapability('viewport-metrics').getViewportMetrics();
	const relative = Math.min(1, metrics.windowInner.width / metrics.screen.width);
	const responsiveness = 1 - relative;
	const minRatio = constants.RESOURCE_PANEL_MIN_RATIO;
	const maxRatio = resourcePanelMaxRatio();
	const ratio = constants.RESOURCE_PANEL_DEFAULT_RATIO
		+ responsiveness * (constants.RESOURCE_PANEL_MAX_RATIO - constants.RESOURCE_PANEL_DEFAULT_RATIO) * 0.6;
	return clamp(ratio, minRatio, maxRatio);
}

export function clampResourcePanelRatio(ratio: number): number {
	const minRatio = constants.RESOURCE_PANEL_MIN_RATIO;
	const maxRatio = resourcePanelMaxRatio();
	return clamp(ratio, minRatio, maxRatio);
}

export function computeResourcePanelPixelWidth(ratio: number): number {
	return Math.trunc(editorViewState.viewportWidth * ratio);
}

function resourcePanelMaxRatio(): number {
	return Math.max(
		constants.RESOURCE_PANEL_MIN_RATIO,
		Math.min(constants.RESOURCE_PANEL_MAX_RATIO, 1 - constants.RESOURCE_PANEL_MIN_EDITOR_RATIO),
	);
}

export function writeResourcePanelBounds(out: RectBounds, widthRatio: number): boolean {
	const width = computeResourcePanelPixelWidth(widthRatio);
	if (width <= 0) {
		return false;
	}
	const top = codeViewportTop();
	const bottom = editorViewState.viewportHeight - bottomMargin();
	if (bottom <= top) {
		return false;
	}
	out.left = 0;
	out.top = top;
	out.right = width;
	out.bottom = bottom;
	return true;
}

export function resourcePanelLineCapacity(bounds: RectBounds, itemCount: number, maxLineWidth: number, lineHeight: number): number {
	const overlayTop = bounds.top;
	const overlayBottom = bounds.bottom;
	let contentHeight = Math.max(0, overlayBottom - overlayTop);
	let initialCapacity = Math.max(1, Math.floor(contentHeight / lineHeight));
	const needsVerticalScrollbar = itemCount > initialCapacity;
	const contentLeft = bounds.left + constants.RESOURCE_PANEL_PADDING_X;
	const dividerLeft = bounds.right - 1;
	const availableRight = needsVerticalScrollbar ? dividerLeft - constants.SCROLLBAR_WIDTH : dividerLeft;
	const availableWidth = Math.max(0, availableRight - contentLeft);
	const needsHorizontalScrollbar = maxLineWidth > availableWidth;
	if (needsHorizontalScrollbar) {
		contentHeight = Math.max(0, contentHeight - constants.SCROLLBAR_WIDTH);
		initialCapacity = Math.max(1, Math.floor(contentHeight / lineHeight));
	}
	return initialCapacity;
}

export function computeResourcePanelMaxHScroll(bounds: RectBounds, itemCount: number, maxLineWidth: number, lineHeight: number): number {
	const contentLeft = bounds.left + constants.RESOURCE_PANEL_PADDING_X;
	const capacity = resourcePanelLineCapacity(bounds, itemCount, maxLineWidth, lineHeight);
	const needsScrollbar = itemCount > capacity;
	const availableRight = needsScrollbar ? bounds.right - 1 - constants.SCROLLBAR_WIDTH : bounds.right - 1;
	const availableWidth = Math.max(0, availableRight - contentLeft);
	const maxScroll = maxLineWidth - availableWidth;
	return maxScroll > 0 ? maxScroll : 0;
}
