#pragma once

#include "common/types.h"
#include "common/vector.h"
#include <algorithm>

namespace bmsx {


struct RectBounds {
	f32 left = 0.0f;
	f32 top = 0.0f;
	f32 right = 0.0f;
	f32 bottom = 0.0f;
	f32 z = 0.0f;
};

inline RectBounds& moveArea(RectBounds& a, const Vec3& p) {
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

inline RectBounds create_rect_bounds() {
	return {};
}

inline void write_rect_bounds(RectBounds& a, f32 left, f32 top, f32 right, f32 bottom) {
	a.left = left;
	a.top = top;
	a.right = right;
	a.bottom = bottom;
}

inline void clear_rect_bounds(RectBounds& a) {
	a.left = 0.0f;
	a.top = 0.0f;
	a.right = 0.0f;
	a.bottom = 0.0f;
}

inline void copy_rect_bounds(RectBounds& a, const RectBounds& n) {
	a.left = n.left;
	a.top = n.top;
	a.right = n.right;
	a.bottom = n.bottom;
}

inline RectBounds new_area3d(f32 sx, f32 sy, f32 z, f32 ex, f32 ey) {
	if (ex < sx) {
		std::swap(sx, ex);
	}
	if (ey < sy) {
		std::swap(sy, ey);
	}
	return {sx, sy, ex, ey, z};
}

inline RectBounds new_area(f32 sx, f32 sy, f32 ex, f32 ey) {
	return new_area3d(sx, sy, 0.0f, ex, ey);
}

inline Vec2 middlepoint_area(const RectBounds& a) {
	return {static_cast<f32>(static_cast<i32>((a.left + a.right) / 2.0f)), static_cast<f32>(static_cast<i32>((a.top + a.bottom) / 2.0f))};
}

inline RectBounds get_overlap_area(const RectBounds& a, const RectBounds& b) {
	const f32 startX = std::max(a.left, b.left);
	const f32 startY = std::max(a.top, b.top);
	const f32 endX = std::min(a.right, b.right);
	const f32 endY = std::min(a.bottom, b.bottom);
	return new_area(startX, startY, endX, endY);
}

inline bool point_in_rect(f32 x, f32 y, const RectBounds& rect) {
	return x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom;
}

struct Rect {
	f32 x = 0.0f;
	f32 y = 0.0f;
	f32 width = 0.0f;
	f32 height = 0.0f;

	Rect() = default;
	Rect(f32 x_, f32 y_, f32 w_, f32 h_) : x(x_), y(y_), width(w_), height(h_) {}

	f32 left() const { return x; }
	f32 right() const { return x + width; }
	f32 top() const { return y; }
	f32 bottom() const { return y + height; }

	Vec2 center() const { return {x + width * 0.5f, y + height * 0.5f}; }
	Vec2 size() const { return {width, height}; }

	bool contains(const Vec2& point) const {
		return point.x >= x && point.x < x + width
			&& point.y >= y && point.y < y + height;
	}

	bool intersects(const Rect& other) const {
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
