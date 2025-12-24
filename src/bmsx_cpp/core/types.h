/*
 * types.h - Core type definitions for BMSX
 *
 * This header defines fundamental types used throughout the engine.
 */

#ifndef BMSX_TYPES_H
#define BMSX_TYPES_H

#include <cstdint>
#include <cstddef>
#include <string>
#include <string_view>
#include <optional>
#include <variant>
#include <functional>
#include <memory>
#include <vector>
#include <unordered_map>
#include <array>

namespace bmsx {

/* ============================================================================
 * Basic numeric types
 * ============================================================================ */

using i8  = int8_t;
using i16 = int16_t;
using i32 = int32_t;
using i64 = int64_t;

using u8  = uint8_t;
using u16 = uint16_t;
using u32 = uint32_t;
using u64 = uint64_t;

using f32 = float;
using f64 = double;

/* ============================================================================
 * Canonicalization
 * ============================================================================ */

enum class CanonicalizationType {
	None,
	Upper,
	Lower,
};

/* ============================================================================
 * Vector types
 * ============================================================================ */

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

/* ============================================================================
 * Rectangle types
 * ============================================================================ */

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
        return point.x >= x && point.x < x + width &&
               point.y >= y && point.y < y + height;
    }

    bool intersects(const Rect& other) const {
        return x < other.x + other.width && x + width > other.x &&
               y < other.y + other.height && y + height > other.y;
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

/* ============================================================================
 * Color types
 * ============================================================================ */

struct Color {
    f32 r = 1.0f;
    f32 g = 1.0f;
    f32 b = 1.0f;
    f32 a = 1.0f;

    Color() = default;
    Color(f32 r_, f32 g_, f32 b_, f32 a_ = 1.0f) : r(r_), g(g_), b(b_), a(a_) {}

    static Color fromRGBA8(u8 r, u8 g, u8 b, u8 a = 255) {
        return {r / 255.0f, g / 255.0f, b / 255.0f, a / 255.0f};
    }

    static Color fromHex(u32 hex) {
        return fromRGBA8(
            (hex >> 24) & 0xFF,
            (hex >> 16) & 0xFF,
            (hex >> 8) & 0xFF,
            hex & 0xFF
        );
    }

    u32 toRGBA8() const {
        return (static_cast<u32>(r * 255) << 24) |
               (static_cast<u32>(g * 255) << 16) |
               (static_cast<u32>(b * 255) << 8) |
               static_cast<u32>(a * 255);
    }

    // Convert to ARGB32 format (common for framebuffers)
    u32 toARGB32() const {
        u8 ai = static_cast<u8>(std::min(1.0f, std::max(0.0f, a)) * 255.0f);
        u8 ri = static_cast<u8>(std::min(1.0f, std::max(0.0f, r)) * 255.0f);
        u8 gi = static_cast<u8>(std::min(1.0f, std::max(0.0f, g)) * 255.0f);
        u8 bi = static_cast<u8>(std::min(1.0f, std::max(0.0f, b)) * 255.0f);
        return (ai << 24) | (ri << 16) | (gi << 8) | bi;
    }

    // Convert to RGBA32 format
    u32 toRGBA32() const {
        u8 ri = static_cast<u8>(std::min(1.0f, std::max(0.0f, r)) * 255.0f);
        u8 gi = static_cast<u8>(std::min(1.0f, std::max(0.0f, g)) * 255.0f);
        u8 bi = static_cast<u8>(std::min(1.0f, std::max(0.0f, b)) * 255.0f);
        u8 ai = static_cast<u8>(std::min(1.0f, std::max(0.0f, a)) * 255.0f);
        return (ri << 24) | (gi << 16) | (bi << 8) | ai;
    }

    // Predefined colors
    static Color white() { return {1.0f, 1.0f, 1.0f, 1.0f}; }
    static Color black() { return {0.0f, 0.0f, 0.0f, 1.0f}; }
    static Color red() { return {1.0f, 0.0f, 0.0f, 1.0f}; }
    static Color green() { return {0.0f, 1.0f, 0.0f, 1.0f}; }
    static Color blue() { return {0.0f, 0.0f, 1.0f, 1.0f}; }
    static Color transparent() { return {0.0f, 0.0f, 0.0f, 0.0f}; }
};

/* ============================================================================
 * Transform
 * ============================================================================ */

struct Transform2D {
    Vec2 position{0.0f, 0.0f};
    f32 rotation = 0.0f;  // radians
    Vec2 scale{1.0f, 1.0f};

    Transform2D() = default;
    Transform2D(Vec2 pos, f32 rot = 0.0f, Vec2 scl = {1.0f, 1.0f})
        : position(pos), rotation(rot), scale(scl) {}
};

/* ============================================================================
 * Time
 * ============================================================================ */

struct TimeSpan {
    i64 ticks = 0;  // In microseconds

    static TimeSpan fromSeconds(f64 seconds) {
        return {static_cast<i64>(seconds * 1000000.0)};
    }

    static TimeSpan fromMilliseconds(i64 ms) {
        return {ms * 1000};
    }

    f64 toSeconds() const { return ticks / 1000000.0; }
    i64 toMilliseconds() const { return ticks / 1000; }

    TimeSpan operator+(const TimeSpan& other) const { return {ticks + other.ticks}; }
    TimeSpan operator-(const TimeSpan& other) const { return {ticks - other.ticks}; }
    bool operator<(const TimeSpan& other) const { return ticks < other.ticks; }
    bool operator>(const TimeSpan& other) const { return ticks > other.ticks; }
    bool operator<=(const TimeSpan& other) const { return ticks <= other.ticks; }
    bool operator>=(const TimeSpan& other) const { return ticks >= other.ticks; }
};

/* ============================================================================
 * Utility templates
 * ============================================================================ */

// Non-owning span (C++20 has std::span, but we define our own for compatibility)
template<typename T>
struct Span {
    T* data_ = nullptr;
    size_t size_ = 0;

    Span() = default;
    Span(T* d, size_t s) : data_(d), size_(s) {}

    template<size_t N>
    Span(T (&arr)[N]) : data_(arr), size_(N) {}

    template<typename Container>
    Span(Container& c) : data_(c.data()), size_(c.size()) {}

    T* data() const { return data_; }
    size_t size() const { return size_; }
    bool empty() const { return size_ == 0; }

    T& operator[](size_t i) { return data_[i]; }
    const T& operator[](size_t i) const { return data_[i]; }

    T* begin() { return data_; }
    T* end() { return data_ + size_; }
    const T* begin() const { return data_; }
    const T* end() const { return data_ + size_; }
};

/* ============================================================================
 * Result type for error handling
 * ============================================================================ */

template<typename T, typename E = std::string>
class Result {
public:
    static Result ok(T value) {
        Result r;
        r.m_value = std::move(value);
        r.m_is_ok = true;
        return r;
    }

    static Result err(E error) {
        Result r;
        r.m_error = std::move(error);
        r.m_is_ok = false;
        return r;
    }

    bool isOk() const { return m_is_ok; }
    bool isErr() const { return !m_is_ok; }

    T& value() { return m_value; }
    const T& value() const { return m_value; }

    E& error() { return m_error; }
    const E& error() const { return m_error; }

    T valueOr(T default_value) const {
        return m_is_ok ? m_value : default_value;
    }

private:
    T m_value{};
    E m_error{};
    bool m_is_ok = false;
};

} // namespace bmsx

#endif // BMSX_TYPES_H
