/*
 * primitives.h - Core type definitions for BMSX
 *
 * This header defines fundamental types used throughout the machine runtime.
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

#define BMSX_RUNTIME_ERROR(message) std::runtime_error(message)

#include "common/rect.h"
#include "common/types.h"
#include "common/vector.h"

namespace bmsx {

/* ============================================================================
 * Transform
 * ============================================================================ */

struct Transform2D {
	Vec2 position{.x=0.0F, .y=0.0F};
	f32 rotation = 0.0F;  // radians
	Vec2 scale{.x=1.0F, .y=1.0F};

	Transform2D() = default;
	Transform2D(Vec2 pos, f32 rot = 0.0F, Vec2 scl = {.x=1.0F, .y=1.0F})
		: position(pos), rotation(rot), scale(scl) {}
};

/* ============================================================================
 * Time
 * ============================================================================ */

struct TimeSpan {
	i64 ticks = 0;  // In microseconds

	static auto fromSeconds(f64 seconds) -> TimeSpan {
		return {static_cast<i64>(seconds * 1000000.0)};
	}

	static auto fromMilliseconds(i64 ms) -> TimeSpan {
		return {ms * 1000};
	}

	[[nodiscard]] auto toSeconds() const -> f64 { return ticks / 1000000.0; }
	[[nodiscard]] auto toMilliseconds() const -> i64 { return ticks / 1000; }

	auto operator+(const TimeSpan& other) const -> TimeSpan { return {ticks + other.ticks}; }
	auto operator-(const TimeSpan& other) const -> TimeSpan { return {ticks - other.ticks}; }
	auto operator<(const TimeSpan& other) const -> bool { return ticks < other.ticks; }
	auto operator>(const TimeSpan& other) const -> bool { return ticks > other.ticks; }
	auto operator<=(const TimeSpan& other) const -> bool { return ticks <= other.ticks; }
	auto operator>=(const TimeSpan& other) const -> bool { return ticks >= other.ticks; }
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

	auto data() const -> T* { return data_; }
	[[nodiscard]] auto size() const -> size_t { return size_; }
	[[nodiscard]] auto empty() const -> bool { return size_ == 0; }

	auto operator[](size_t i) -> T& { return data_[i]; }
	auto operator[](size_t i) const -> const T& { return data_[i]; }

	auto begin() -> T* { return data_; }
	auto end() -> T* { return data_ + size_; }
	auto begin() const -> const T* { return data_; }
	auto end() const -> const T* { return data_ + size_; }
};

/* ============================================================================
 * Result type for error handling
 * ============================================================================ */

template<typename T, typename E = std::string>
class Result {
public:
	static auto ok(T value) -> Result {
		Result r;
		r.m_value = std::move(value);
		r.m_is_ok = true;
		return r;
	}

	static auto err(E error) -> Result {
		Result r;
		r.m_error = std::move(error);
		r.m_is_ok = false;
		return r;
	}

	[[nodiscard]] auto isOk() const -> bool { return m_is_ok; }
	[[nodiscard]] auto isErr() const -> bool { return !m_is_ok; }

	auto value() -> T& { return m_value; }
	auto value() const -> const T& { return m_value; }

	auto error() -> E& { return m_error; }
	auto error() const -> const E& { return m_error; }

	auto valueOr(T default_value) const -> T {
		return m_is_ok ? m_value : default_value;
	}

private:
	T m_value{};
	E m_error{};
	bool m_is_ok = false;
};

} // namespace bmsx

#endif // BMSX_TYPES_H
