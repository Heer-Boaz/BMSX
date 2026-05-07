#include "common/vector.h"

#include <cmath>

namespace bmsx {

f32 Vec2::length() const {
	return std::sqrt(x * x + y * y);
}

Vec2 Vec2::normalized() const {
	const f32 len = length();
	if (len > 0.0f) {
		return {x / len, y / len};
	}
	return {0.0f, 0.0f};
}

f32 Vec3::length() const {
	return std::sqrt(x * x + y * y + z * z);
}

Vec3 Vec3::normalized() const {
	const f32 len = length();
	if (len > 0.0f) {
		return {x / len, y / len, z / len};
	}
	return {0.0f, 0.0f, 0.0f};
}

Vec3 Vec3::cross(const Vec3& other) const {
	return {
		y * other.z - z * other.y,
		z * other.x - x * other.z,
		x * other.y - y * other.x
	};
}

Vec2 translate_vec2(const Vec2& a, const Vec2& b) {
	return {a.x + b.x, a.y + b.y};
}

void translate_inplace_vec2(Vec2& a, const Vec2& b) {
	set_inplace_vec2(a, {a.x + b.x, a.y + b.y});
}

Vec3 translate_vec3(const Vec3& a, const Vec3& b) {
	return {a.x + b.x, a.y + b.y, a.z + b.z};
}

void translate_inplace_vec3(Vec3& a, const Vec3& b) {
	a.x += b.x;
	a.y += b.y;
	a.z += b.z;
}

Vec2 new_vec2(f32 x, f32 y) {
	return {x, y};
}

Vec3 new_vec3(f32 x, f32 y, f32 z) {
	return {x, y, z};
}

Vec2 to_vec2(const Vec2& v) {
	return {v.x, v.y};
}

Vec2 to_vec2(const vec2arr& v) {
	return {v[0], v[1]};
}

vec2arr to_vec2arr(const Vec2& v) {
	return {v.x, v.y};
}

vec2arr to_vec2arr(const vec2arr& v) {
	return v;
}

Vec3 to_vec3(const Vec3& v) {
	return {v.x, v.y, v.z};
}

Vec3 to_vec3(const vec3arr& v) {
	return {v[0], v[1], v[2]};
}

vec3arr to_vec3arr(const Vec3& v) {
	return {v.x, v.y, v.z};
}

vec3arr to_vec3arr(const vec3arr& v) {
	return v;
}

Vec2 trunc_vec2(const Vec2& p) {
	return {static_cast<f32>(static_cast<i32>(p.x)), static_cast<f32>(static_cast<i32>(p.y))};
}

Vec3 trunc_vec3(const Vec3& p) {
	return {static_cast<f32>(static_cast<i32>(p.x)), static_cast<f32>(static_cast<i32>(p.y)), static_cast<f32>(static_cast<i32>(p.z))};
}

Vec2 multiply_vec(const Vec2& toMult, f32 factor) {
	return {toMult.x * factor, toMult.y * factor};
}

Vec3 multiply_vec(const Vec3& toMult, f32 factor) {
	return {toMult.x * factor, toMult.y * factor, toMult.z * factor};
}

Vec2 multiply_vec2(const Vec2& toMult, f32 factor) {
	return {toMult.x * factor, toMult.y * factor};
}

Vec3 multiply_vec3(const Vec3& toMult, f32 factor) {
	return {toMult.x * factor, toMult.y * factor, toMult.z * factor};
}

f32 dot_vec3(const Vec3& a, const Vec3& b) {
	return a.x * b.x + a.y * b.y + a.z * b.z;
}

Vec3 cross_vec3(const Vec3& a, const Vec3& b) {
	return {
		a.y * b.z - a.z * b.y,
		a.z * b.x - a.x * b.z,
		a.x * b.y - a.y * b.x
	};
}

Vec3 norm_vec3(const Vec3& a) {
	const f32 len = a.length();
	if (len > 0.0f) {
		return {a.x / len, a.y / len, a.z / len};
	}
	return {0.0f, 0.0f, 0.0f};
}

Vec2 div_vec2(const Vec2& toDivide, f32 divideBy) {
	return {toDivide.x / divideBy, toDivide.y / divideBy};
}

void set_vec2(Vec2& p, f32 newX, f32 newY) {
	p.x = newX;
	p.y = newY;
}

vec2arr copy_vec2arr(const vec2arr& p) {
	return {p[0], p[1]};
}

Vec3 copy_vec3(const Vec3& p) {
	return {p.x, p.y, p.z};
}

Vec2 copy_vec2(const Vec2& p) {
	return {p.x, p.y};
}

bool vec2arr_equals(const vec2arr& a, const vec2arr& b) {
	return a[0] == b[0] && a[1] == b[1];
}

bool vec3arr_equals(const vec3arr& a, const vec3arr& b) {
	return a[0] == b[0] && a[1] == b[1] && a[2] == b[2];
}

void set_inplace_vec2(Vec2& p, const Vec2& n) {
	p.x = n.x;
	p.y = n.y;
}

void set_vec3(Vec3& p, f32 newX, f32 newY, f32 newZ) {
	p.x = newX;
	p.y = newY;
	p.z = newZ;
}

void set_inplace_vec3(Vec3& toOverwrite, const Vec3& data) {
	toOverwrite.x = data.x;
	toOverwrite.y = data.y;
	toOverwrite.z = data.z;
}

f32 line_length(const Vec3& p1, const Vec3& p2) {
	return std::sqrt((p2.x - p1.x) * (p2.x - p1.x) + (p2.y - p1.y) * (p2.y - p1.y)) - 1.0f;
}

} // namespace bmsx
