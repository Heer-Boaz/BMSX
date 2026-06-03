#pragma once

#include "common/types.h"
#include "common/vector.h"
#include <algorithm>

namespace bmsx {


struct RectBounds {
	f32 left = 0.0F;
	f32 top = 0.0F;
	f32 right = 0.0F;
	f32 bottom = 0.0F;
	f32 z = 0.0F;
};

inline auto moveArea(RectBounds& a, const Vec3& p) -> RectBounds& {
	a.top += p.y;
	a.bottom += p.y;
	a.left += p.x;
	a.right += p.x;
	return a;
}

inline void set_inplace_area(RectBounds& a, const RectBounds& n) {
	a.bottom = n.bottom;
	a.left = n.left;
	a.right = n.right;
	a.top = n.top;
}

inline auto create_rect_bounds() -> RectBounds {
	return {};
}

inline void write_rect_bounds(RectBounds& a, f32 left, f32 top, f32 right, f32 bottom) {
	a.left = left;
	a.top = top;
	a.right = right;
	a.bottom = bottom;
}

inline void clear_rect_bounds(RectBounds& a) {
	a.left = 0.0F;
	a.top = 0.0F;
	a.right = 0.0F;
	a.bottom = 0.0F;
}

inline void copy_rect_bounds(RectBounds& a, const RectBounds& n) {
	a.left = n.left;
	a.top = n.top;
	a.right = n.right;
	a.bottom = n.bottom;
}

inline auto new_area3d(f32 sx, f32 sy, f32 z, f32 ex, f32 ey) -> RectBounds {
	if (ex < sx) {
		std::swap(sx, ex);
	}
	if (ey < sy) {
		std::swap(sy, ey);
	}
	return {.left=sx, .top=sy, .right=ex, .bottom=ey, .z=z};
}

inline auto new_area(f32 sx, f32 sy, f32 ex, f32 ey) -> RectBounds {
	return new_area3d(sx, sy, 0.0F, ex, ey);
}

inline auto middlepoint_area(const RectBounds& a) -> Vec2 {
	return {.x=static_cast<f32>(static_cast<i32>((a.left + a.right) / 2.0F)), .y=static_cast<f32>(static_cast<i32>((a.top + a.bottom) / 2.0F))};
}

inline auto get_overlap_area(const RectBounds& a, const RectBounds& b) -> RectBounds {
	const f32 startX = std::max(a.left, b.left);
	const f32 startY = std::max(a.top, b.top);
	const f32 endX = std::min(a.right, b.right);
	const f32 endY = std::min(a.bottom, b.bottom);
	return new_area(startX, startY, endX, endY);
}

inline auto point_in_rect(f32 x, f32 y, const RectBounds& rect) -> bool {
	return x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom;
}

struct Rect {
	f32 x = 0.0F;
	f32 y = 0.0F;
	f32 width = 0.0F;
	f32 height = 0.0F;

	Rect() = default;
	Rect(f32 x_, f32 y_, f32 w_, f32 h_) : x(x_), y(y_), width(w_), height(h_) {}

	[[nodiscard]] auto left() const -> f32 { return x; }
	[[nodiscard]] auto right() const -> f32 { return x + width; }
	[[nodiscard]] auto top() const -> f32 { return y; }
	[[nodiscard]] auto bottom() const -> f32 { return y + height; }

	[[nodiscard]] auto center() const -> Vec2 { return {.x=x + (width * 0.5F), .y=y + (height * 0.5F)}; }
	[[nodiscard]] auto size() const -> Vec2 { return {.x=width, .y=height}; }

	[[nodiscard]] auto contains(const Vec2& point) const -> bool {
		return point.x >= x && point.x < x + width
			&& point.y >= y && point.y < y + height;
	}

	[[nodiscard]] auto intersects(const Rect& other) const -> bool {
		return x < other.x + other.width && x + width > other.x
			&& y < other.y + other.height && y + height > other.y;
	}
};

struct IntRect {
	i32 x = 0;
	i32 y = 0;
	i32 width = 0;
	i32 height = 0;

	IntRect() = default;
	IntRect(i32 x_, i32 y_, i32 w_, i32 h_) : x(x_), y(y_), width(w_), height(h_) {}
};

} // namespace bmsx
