#pragma once

#include "common/types.h"
#include <array>

namespace bmsx {

struct Vec2 {
	f32 x = 0.0f;
	f32 y = 0.0f;

	Vec2() = default;
	Vec2(f32 x_, f32 y_) : x(x_), y(y_) {}

	Vec2 operator+(const Vec2& other) const { return {x + other.x, y + other.y}; }
	Vec2 operator-(const Vec2& other) const { return {x - other.x, y - other.y}; }
	Vec2 operator*(f32 scalar) const { return {x * scalar, y * scalar}; }
	Vec2 operator/(f32 scalar) const { return {x / scalar, y / scalar}; }

	Vec2& operator+=(const Vec2& other) { x += other.x; y += other.y; return *this; }
	Vec2& operator-=(const Vec2& other) { x -= other.x; y -= other.y; return *this; }
	Vec2& operator*=(f32 scalar) { x *= scalar; y *= scalar; return *this; }
	Vec2& operator/=(f32 scalar) { x /= scalar; y /= scalar; return *this; }

	f32 length() const;
	f32 lengthSquared() const { return x * x + y * y; }
	Vec2 normalized() const;
	f32 dot(const Vec2& other) const { return x * other.x + y * other.y; }
};

struct Vec3 {
	f32 x = 0.0f;
	f32 y = 0.0f;
	f32 z = 0.0f;

	Vec3() = default;
	Vec3(f32 x_, f32 y_, f32 z_) : x(x_), y(y_), z(z_) {}

	Vec3 operator+(const Vec3& other) const { return {x + other.x, y + other.y, z + other.z}; }
	Vec3 operator-(const Vec3& other) const { return {x - other.x, y - other.y, z - other.z}; }
	Vec3 operator*(f32 scalar) const { return {x * scalar, y * scalar, z * scalar}; }

	f32 length() const;
	f32 lengthSquared() const { return x * x + y * y + z * z; }
	Vec3 normalized() const;
	f32 dot(const Vec3& other) const { return x * other.x + y * other.y + z * other.z; }
	Vec3 cross(const Vec3& other) const;
};

struct Vec4 {
	f32 x = 0.0f;
	f32 y = 0.0f;
	f32 z = 0.0f;
	f32 w = 0.0f;

	Vec4() = default;
	Vec4(f32 x_, f32 y_, f32 z_, f32 w_) : x(x_), y(y_), z(z_), w(w_) {}
};

using vec2 = Vec2;
using vec3 = Vec3;
using vec2arr = std::array<f32, 2>;
using vec3arr = std::array<f32, 3>;

Vec2 translate_vec2(const Vec2& a, const Vec2& b);
void translate_inplace_vec2(Vec2& a, const Vec2& b);
Vec3 translate_vec3(const Vec3& a, const Vec3& b);
void translate_inplace_vec3(Vec3& a, const Vec3& b);
Vec2 new_vec2(f32 x, f32 y);
Vec3 new_vec3(f32 x, f32 y, f32 z);
Vec2 to_vec2(const Vec2& v);
Vec2 to_vec2(const vec2arr& v);
vec2arr to_vec2arr(const Vec2& v);
vec2arr to_vec2arr(const vec2arr& v);
Vec3 to_vec3(const Vec3& v);
Vec3 to_vec3(const vec3arr& v);
vec3arr to_vec3arr(const Vec3& v);
vec3arr to_vec3arr(const vec3arr& v);
Vec2 trunc_vec2(const Vec2& p);
Vec3 trunc_vec3(const Vec3& p);
Vec2 multiply_vec(const Vec2& toMult, f32 factor);
Vec3 multiply_vec(const Vec3& toMult, f32 factor);
Vec2 multiply_vec2(const Vec2& toMult, f32 factor);
Vec2 div_vec2(const Vec2& toDivide, f32 divideBy);
void set_vec2(Vec2& p, f32 newX, f32 newY);
vec2arr copy_vec2arr(const vec2arr& p);
Vec3 copy_vec3(const Vec3& p);
Vec2 copy_vec2(const Vec2& p);
bool vec2arr_equals(const vec2arr& a, const vec2arr& b);
bool vec3arr_equals(const vec3arr& a, const vec3arr& b);
void set_inplace_vec2(Vec2& p, const Vec2& n);
void set_vec3(Vec3& p, f32 newX, f32 newY, f32 newZ);
void set_inplace_vec3(Vec3& toOverwrite, const Vec3& data);
f32 line_length(const Vec3& p1, const Vec3& p2);

} // namespace bmsx
