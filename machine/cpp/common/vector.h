#pragma once

#include "common/types.h"
#include <array>

namespace bmsx {

struct Vec2 {
	f32 x = 0.0f;
	f32 y = 0.0f;
};

struct Vec3 {
	f32 x = 0.0f;
	f32 y = 0.0f;
	f32 z = 0.0f;
};

struct Vec4 {
	f32 x = 0.0f;
	f32 y = 0.0f;
	f32 z = 0.0f;
	f32 w = 0.0f;
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
Vec3 multiply_vec3(const Vec3& toMult, f32 factor);
f32 dot_vec3(const Vec3& a, const Vec3& b);
Vec3 cross_vec3(const Vec3& a, const Vec3& b);
Vec3 norm_vec3(const Vec3& a);
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
