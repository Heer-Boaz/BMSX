export const VDP_RENDER_CLEAR_COST = 8;
export const VDP_RENDER_ALPHA_COST_MULTIPLIER = 2;
export const VDP_RENDER_TILE_RUN_SETUP_COST = 6;
export const VDP_RENDER_TILE_RUN_DENSITY_DIVISOR = 16;

export type VdpClippedRect = {
	width: number;
	height: number;
	area: number;
};

const LIANG_BARSKY_T = { min: 0, max: 1 };

function liangBarskyClipDenominator(numerator: number, denominator: number, t: { min: number; max: number }): boolean {
	if (denominator === 0) {
		return numerator <= 0;
	}
	const ratio = numerator / denominator;
	if (denominator < 0) {
		if (ratio > t.max) {
			return false;
		}
		if (ratio > t.min) {
			t.min = ratio;
		}
		return true;
	}
	if (ratio < t.min) {
		return false;
	}
	if (ratio < t.max) {
		t.max = ratio;
	}
	return true;
}

export function blitAreaBucket(areaPx: number): number {
	if (areaPx <= 0) {
		return 0;
	}
	if (areaPx <= 16 * 16) {
		return 1;
	}
	if (areaPx <= 32 * 32) {
		return 2;
	}
	if (areaPx <= 64 * 64) {
		return 4;
	}
	if (areaPx <= 128 * 128) {
		return 8;
	}
	return 16;
}

export function blitSpanBucket(spanPx: number): number {
	if (spanPx <= 0) {
		return 0;
	}
	if (spanPx <= 32) {
		return 1;
	}
	if (spanPx <= 96) {
		return 2;
	}
	return 4;
}

export function tileRunCost(visibleRows: number, visibleNonEmptyTiles: number): number {
	if (visibleRows <= 0 || visibleNonEmptyTiles <= 0) {
		return 0;
	}
	return VDP_RENDER_TILE_RUN_SETUP_COST + visibleRows + Math.ceil(visibleNonEmptyTiles / VDP_RENDER_TILE_RUN_DENSITY_DIVISOR);
}

export function computeClippedRect(x0: number, y0: number, x1: number, y1: number, clipWidth: number, clipHeight: number, out: VdpClippedRect): VdpClippedRect {
	if (clipWidth <= 0 || clipHeight <= 0) {
		out.width = 0;
		out.height = 0;
		out.area = 0;
		return out;
	}
	let left = x0;
	let right = x1;
	if (right < left) {
		const swap = left;
		left = right;
		right = swap;
	}
	let top = y0;
	let bottom = y1;
	if (bottom < top) {
		const swap = top;
		top = bottom;
		bottom = swap;
	}
	if (left < 0) {
		left = 0;
	}
	if (top < 0) {
		top = 0;
	}
	if (right > clipWidth) {
		right = clipWidth;
	}
	if (bottom > clipHeight) {
		bottom = clipHeight;
	}
	const width = right > left ? right - left : 0;
	const height = bottom > top ? bottom - top : 0;
	out.width = width;
	out.height = height;
	out.area = width * height;
	return out;
}

export function computeClippedLineSpan(x0: number, y0: number, x1: number, y1: number, clipWidth: number, clipHeight: number): number {
	if (clipWidth <= 0 || clipHeight <= 0) {
		return 0;
	}
	const dx = x1 - x0;
	const dy = y1 - y0;
	const t = LIANG_BARSKY_T;
	t.min = 0;
	t.max = 1;
	if (!liangBarskyClipDenominator(x0, -dx, t)) {
		return 0;
	}
	if (!liangBarskyClipDenominator(x0 - clipWidth, dx, t)) {
		return 0;
	}
	if (!liangBarskyClipDenominator(y0, -dy, t)) {
		return 0;
	}
	if (!liangBarskyClipDenominator(y0 - clipHeight, dy, t)) {
		return 0;
	}
	const clippedDx = dx * (t.max - t.min);
	const clippedDy = dy * (t.max - t.min);
	const span = Math.max(Math.abs(clippedDx), Math.abs(clippedDy));
	return span > 0 ? span : 1;
}
