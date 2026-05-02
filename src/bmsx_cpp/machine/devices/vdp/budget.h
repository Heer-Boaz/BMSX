#pragma once

#include <algorithm>
#include <cmath>

namespace bmsx {

constexpr int VDP_RENDER_CLEAR_COST = 8;
constexpr int VDP_RENDER_ALPHA_COST_MULTIPLIER = 2;
constexpr int VDP_RENDER_TILE_RUN_SETUP_COST = 6;
constexpr int VDP_RENDER_BILLBOARD_COST = 1;
constexpr int VDP_RENDER_TILE_RUN_DENSITY_DIVISOR = 16;

struct VdpClippedRect {
	double width = 0.0;
	double height = 0.0;
	double area = 0.0;
};

inline bool liangBarskyClipDenominator(double numerator, double denominator, double& tMin, double& tMax) {
	if (denominator == 0.0) {
		return numerator <= 0.0;
	}
	const double ratio = numerator / denominator;
	if (denominator < 0.0) {
		if (ratio > tMax) {
			return false;
		}
		if (ratio > tMin) {
			tMin = ratio;
		}
		return true;
	}
	if (ratio < tMin) {
		return false;
	}
	if (ratio < tMax) {
		tMax = ratio;
	}
	return true;
}

inline int blitAreaBucket(double areaPx) {
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

inline int blitSpanBucket(double spanPx) {
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

inline int tileRunCost(int visibleRows, int visibleNonEmptyTiles) {
	if (visibleRows <= 0 || visibleNonEmptyTiles <= 0) {
		return 0;
	}
	return VDP_RENDER_TILE_RUN_SETUP_COST + visibleRows + static_cast<int>(std::ceil(static_cast<double>(visibleNonEmptyTiles) / static_cast<double>(VDP_RENDER_TILE_RUN_DENSITY_DIVISOR)));
}

inline VdpClippedRect computeClippedRect(double x0, double y0, double x1, double y1, double clipWidth, double clipHeight) {
	if (clipWidth <= 0 || clipHeight <= 0) {
		return {};
	}
	double left = x0;
	double right = x1;
	if (right < left) {
		std::swap(left, right);
	}
	double top = y0;
	double bottom = y1;
	if (bottom < top) {
		std::swap(top, bottom);
	}
	left = std::max(left, 0.0);
	top = std::max(top, 0.0);
	right = std::min(right, clipWidth);
	bottom = std::min(bottom, clipHeight);
	const double width = right > left ? right - left : 0.0;
	const double height = bottom > top ? bottom - top : 0.0;
	return {
		width,
		height,
		width * height,
	};
}

inline double computeClippedLineSpan(double x0, double y0, double x1, double y1, double clipWidth, double clipHeight) {
	if (clipWidth <= 0 || clipHeight <= 0) {
		return 0.0;
	}
	const double dx = x1 - x0;
	const double dy = y1 - y0;
	double tMin = 0.0;
	double tMax = 1.0;
	if (!liangBarskyClipDenominator(x0, -dx, tMin, tMax)) {
		return 0.0;
	}
	if (!liangBarskyClipDenominator(x0 - clipWidth, dx, tMin, tMax)) {
		return 0.0;
	}
	if (!liangBarskyClipDenominator(y0, -dy, tMin, tMax)) {
		return 0.0;
	}
	if (!liangBarskyClipDenominator(y0 - clipHeight, dy, tMin, tMax)) {
		return 0.0;
	}
	const double clippedDx = dx * (tMax - tMin);
	const double clippedDy = dy * (tMax - tMin);
	const double span = std::max(std::abs(clippedDx), std::abs(clippedDy));
	return span > 0.0 ? span : 1.0;
}

} // namespace bmsx
