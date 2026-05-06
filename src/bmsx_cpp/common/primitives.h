/*
 * primitives.h - Core type definitions for BMSX
 *
 * This header defines fundamental types used throughout the console runtime.
 */

#ifndef BMSX_TYPES_H
#define BMSX_TYPES_H

#include <string>
#include <string_view>
#include <optional>
#include <variant>
#include <functional>
#include <memory>
#include <vector>
#include <unordered_map>
#include <array>
#include <stdexcept>
#include <utility>

#if defined(BMSX_SNESMINI_LEGACY)
#define BMSX_RUNTIME_ERROR(message) std::runtime_error(std::string(message))
#else
#define BMSX_RUNTIME_ERROR(message) std::runtime_error(message)
#endif

#include "common/color.h"
#include "common/rect.h"
#include "common/types.h"
#include "common/vector.h"

namespace bmsx {

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
