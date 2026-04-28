import { consoleCore } from '../../../../../core/console';
import type { RectBounds } from '../../../../../rompack/format';
import { clamp } from '../../../../../common/clamp';
import { copy_rect_bounds, create_rect_bounds, write_rect_bounds } from '../../../../../common/rect';
import * as constants from '../../../../common/constants';
import { codeViewportTop } from '../../../../editor/ui/view/view';
import { bottomMargin } from '../../../common/layout';
import { editorViewState } from '../../../../editor/ui/view/state';

export function defaultResourcePanelRatio(): number {
	const metrics = consoleCore.platform.gameviewHost.getCapability('viewport-metrics').getViewportMetrics();
	const screenRelativeWidth = metrics.windowInner.width / metrics.screen.width;
	const relative = screenRelativeWidth < 1 ? screenRelativeWidth : 1;
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
	return (editorViewState.viewportWidth * ratio) | 0;
}

function resourcePanelMaxRatio(): number {
	const maxRatio = constants.RESOURCE_PANEL_MAX_RATIO < 1 - constants.RESOURCE_PANEL_MIN_EDITOR_RATIO
		? constants.RESOURCE_PANEL_MAX_RATIO
		: 1 - constants.RESOURCE_PANEL_MIN_EDITOR_RATIO;
	return maxRatio > constants.RESOURCE_PANEL_MIN_RATIO ? maxRatio : constants.RESOURCE_PANEL_MIN_RATIO;
}

export type ResourcePanelLayout = {
	bounds: RectBounds;
	verticalTrack: RectBounds;
	horizontalTrack: RectBounds;
	contentLeft: number;
	contentTop: number;
	contentRight: number;
	effectiveBottom: number;
	dividerLeft: number;
	availableWidth: number;
	capacity: number;
	maxVerticalScroll: number;
	maxHorizontalScroll: number;
	verticalVisible: boolean;
	horizontalVisible: boolean;
};

export function createResourcePanelLayout(bounds: RectBounds): ResourcePanelLayout {
	return {
		bounds,
		verticalTrack: create_rect_bounds(),
		horizontalTrack: create_rect_bounds(),
		contentLeft: 0,
		contentTop: 0,
		contentRight: 0,
		effectiveBottom: 0,
		dividerLeft: 0,
		availableWidth: 0,
		capacity: 1,
		maxVerticalScroll: 0,
		maxHorizontalScroll: 0,
		verticalVisible: false,
		horizontalVisible: false,
	};
}

const lineCapacityBoundsScratch = create_rect_bounds();
const lineCapacityLayoutScratch = createResourcePanelLayout(lineCapacityBoundsScratch);

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

function lineCapacityFromHeight(contentHeight: number, lineHeight: number): number {
	const capacity = (contentHeight / lineHeight) | 0;
	return capacity > 0 ? capacity : 1;
}

export function writeResourcePanelLayout(
	out: ResourcePanelLayout,
	itemCount: number,
	maxLineWidth: number,
	lineHeight: number,
): ResourcePanelLayout {
	const bounds = out.bounds;
	const dividerLeft = bounds.right - 1;
	const contentLeft = bounds.left + constants.RESOURCE_PANEL_PADDING_X;
	const contentTop = bounds.top + 2;
	let contentHeight = bounds.bottom - bounds.top;
	let capacity = lineCapacityFromHeight(contentHeight, lineHeight);
	let verticalVisible = itemCount > capacity;
	let availableRight = verticalVisible ? dividerLeft - constants.SCROLLBAR_WIDTH : dividerLeft;
	let availableWidth = availableRight - contentLeft;
	let horizontalVisible = maxLineWidth > availableWidth;
	if (horizontalVisible) {
		contentHeight -= constants.SCROLLBAR_WIDTH;
		capacity = lineCapacityFromHeight(contentHeight, lineHeight);
		if (!verticalVisible && itemCount > capacity) {
			verticalVisible = true;
			availableRight = dividerLeft - constants.SCROLLBAR_WIDTH;
			availableWidth = availableRight - contentLeft;
			horizontalVisible = maxLineWidth > availableWidth;
		}
	}
	const contentRight = verticalVisible ? dividerLeft - constants.SCROLLBAR_WIDTH : bounds.right;
	const effectiveBottom = horizontalVisible ? bounds.bottom - constants.SCROLLBAR_WIDTH : bounds.bottom;
	const maxVerticalScroll = itemCount - capacity;
	const maxHorizontalScroll = maxLineWidth - (contentRight - contentLeft);

	out.contentLeft = contentLeft;
	out.contentTop = contentTop;
	out.contentRight = contentRight;
	out.effectiveBottom = effectiveBottom;
	out.dividerLeft = dividerLeft;
	out.availableWidth = contentRight - contentLeft;
	out.capacity = capacity;
	out.maxVerticalScroll = maxVerticalScroll > 0 ? maxVerticalScroll : 0;
	out.maxHorizontalScroll = maxHorizontalScroll > 0 ? maxHorizontalScroll : 0;
	out.verticalVisible = verticalVisible;
	out.horizontalVisible = horizontalVisible;

	write_rect_bounds(out.verticalTrack, dividerLeft - constants.SCROLLBAR_WIDTH, bounds.top, dividerLeft, bounds.bottom);
	write_rect_bounds(out.horizontalTrack, contentLeft, bounds.bottom - constants.SCROLLBAR_WIDTH, contentRight, bounds.bottom);
	return out;
}

export function resourcePanelLineCapacity(bounds: RectBounds, itemCount: number, maxLineWidth: number, lineHeight: number): number {
	copy_rect_bounds(lineCapacityBoundsScratch, bounds);
	return writeResourcePanelLayout(lineCapacityLayoutScratch, itemCount, maxLineWidth, lineHeight).capacity;
}
