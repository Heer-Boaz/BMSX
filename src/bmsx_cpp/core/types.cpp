/*
 * types.cpp - Implementation of core types
 */

#include "types.h"
#include <cmath>

namespace bmsx {

/* ============================================================================
 * Vec2 implementation
 * ============================================================================ */

f32 Vec2::length() const {
    return std::sqrt(x * x + y * y);
}

Vec2 Vec2::normalized() const {
    f32 len = length();
    if (len > 0.0f) {
        return {x / len, y / len};
    }
    return {0.0f, 0.0f};
}

/* ============================================================================
 * Vec3 implementation
 * ============================================================================ */

f32 Vec3::length() const {
    return std::sqrt(x * x + y * y + z * z);
}

Vec3 Vec3::normalized() const {
    f32 len = length();
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

} // namespace bmsx
