#pragma once

#include "machine/common/numeric.h"

#include <optional>
#include <string>
#include <utility>

namespace bmsx {

enum class InputSource {
	Keyboard,
	Gamepad,
	Pointer
};

inline const InputSource INPUT_SOURCES[] = {
	InputSource::Keyboard,
	InputSource::Gamepad,
	InputSource::Pointer
};

constexpr size_t INPUT_SOURCE_COUNT = 3;

using ButtonId = std::string;

struct ButtonState {
	bool pressed = false;
	bool justpressed = false;
	bool justreleased = false;
	bool waspressed = false;
	bool wasreleased = false;
	bool consumed = false;

	std::optional<f64> presstime;
	std::optional<f64> timestamp;
	std::optional<f64> pressedAtMs;
	std::optional<f64> releasedAtMs;
	std::optional<i32> pressId;

	f32 value = 0.0F;
	std::optional<Vec2> value2d;

	ButtonState() = default;

	void reset() {
		pressed = false;
		justpressed = false;
		justreleased = false;
		waspressed = false;
		wasreleased = false;
		consumed = false;
		presstime.reset();
		timestamp.reset();
		pressedAtMs.reset();
		releasedAtMs.reset();
		pressId.reset();
		value = 0.0F;
		value2d.reset();
	}
};

inline auto buttonTimestampOr(const ButtonState& state, f64 fallback) -> f64 {
	if (state.timestamp.has_value()) {
		return state.timestamp.value();
	}
	return fallback;
}

inline auto buttonPressedAtOr(const ButtonState& state, f64 fallback) -> f64 {
	if (state.pressedAtMs.has_value()) {
		return state.pressedAtMs.value();
	}
	return buttonTimestampOr(state, fallback);
}

inline auto buttonReleasedAtOr(const ButtonState& state, f64 fallback) -> f64 {
	if (state.releasedAtMs.has_value()) {
		return state.releasedAtMs.value();
	}
	return buttonTimestampOr(state, fallback);
}

inline auto buttonPressIdOr(const ButtonState& state, i32 fallback) -> i32 {
	if (state.pressId.has_value()) {
		return state.pressId.value();
	}
	return fallback;
}

inline auto resolveButtonPressId(const std::optional<i32>& incoming, const ButtonState& state, i32& nextPressId) -> i32 {
	if (incoming.has_value()) {
		return incoming.value();
	}
	if (state.pressId.has_value()) {
		return state.pressId.value();
	}
	return nextPressId++;
}

inline auto buttonPressTimeOrZero(const ButtonState& state) -> f64 {
	if (state.presstime.has_value()) {
		return state.presstime.value();
	}
	return 0.0;
}

struct ActionState : ButtonState {
	std::string action;
	bool alljustpressed = false;
	bool allwaspressed = false;
	bool alljustreleased = false;
	std::optional<bool> guardedjustpressed;
	std::optional<bool> repeatpressed;
	std::optional<i32> repeatcount;

	ActionState() = default;

	explicit ActionState(std::string actionName)
		: action(std::move(actionName)) {}

	ActionState(std::string actionName, const ButtonState& state)
		: ButtonState(state), action(std::move(actionName)) {}
};

inline auto actionFlag(const std::optional<bool>& flag) -> bool {
	return flag.has_value() && flag.value();
}

inline auto actionRepeatCount(const ActionState& state) -> i32 {
	if (state.repeatcount.has_value()) {
		return state.repeatcount.value();
	}
	return 0;
}

constexpr u32 INP_STATUS_PRESSED = 1u << 0u;
constexpr u32 INP_STATUS_JUST_PRESSED = 1u << 1u;
constexpr u32 INP_STATUS_JUST_RELEASED = 1u << 2u;
constexpr u32 INP_STATUS_WAS_PRESSED = 1u << 3u;
constexpr u32 INP_STATUS_WAS_RELEASED = 1u << 4u;
constexpr u32 INP_STATUS_CONSUMED = 1u << 5u;
constexpr u32 INP_STATUS_ALL_JUST_PRESSED = 1u << 6u;
constexpr u32 INP_STATUS_ALL_JUST_RELEASED = 1u << 7u;
constexpr u32 INP_STATUS_ALL_WAS_PRESSED = 1u << 8u;
constexpr u32 INP_STATUS_GUARDED_JUST_PRESSED = 1u << 9u;
constexpr u32 INP_STATUS_REPEAT_PRESSED = 1u << 10u;
constexpr u32 INP_STATUS_HAS_VALUE = 1u << 11u;

constexpr i32 INPUT_CONTROLLER_PLAYER_COUNT = 4;
constexpr u32 INPUT_CONTROLLER_PLAYER_SELECT_MASK = static_cast<u32>(INPUT_CONTROLLER_PLAYER_COUNT - 1);
constexpr u32 INPUT_CONTROLLER_EVENT_FIFO_CAPACITY = 32u;
constexpr u32 INP_EVENT_STATUS_EMPTY = 1u << 0u;
constexpr u32 INP_EVENT_STATUS_FULL = 1u << 1u;
constexpr u32 INP_EVENT_STATUS_OVERFLOW = 1u << 2u;
constexpr u32 INP_EVENT_CTRL_POP = 1u;
constexpr u32 INP_EVENT_CTRL_CLEAR = 2u;
constexpr u32 INP_EVENT_ACTION_STATUS_MASK = INP_STATUS_JUST_PRESSED
	| INP_STATUS_JUST_RELEASED
	| INP_STATUS_ALL_JUST_PRESSED
	| INP_STATUS_ALL_JUST_RELEASED
	| INP_STATUS_GUARDED_JUST_PRESSED
	| INP_STATUS_REPEAT_PRESSED;

constexpr u32 INPUT_CONTROLLER_OUTPUT_INTENSITY_Q16_ONE = static_cast<u32>(FIX16_ONE);
constexpr u32 INP_OUTPUT_STATUS_SUPPORTED = 1u << 0u;
constexpr u32 INP_OUTPUT_CTRL_APPLY = 1u;

inline i32 decodeInputControllerPlayerSelect(u32 playerWord) {
	return static_cast<i32>(((playerWord - 1u) & INPUT_CONTROLLER_PLAYER_SELECT_MASK) + 1u);
}

inline f32 decodeInputOutputIntensityQ16(u32 value) {
	return static_cast<f32>(value) / static_cast<f32>(INPUT_CONTROLLER_OUTPUT_INTENSITY_Q16_ONE);
}

inline u32 packInputActionStatus(const ActionState& state) {
	u32 word = 0u;
	if (state.pressed) word |= INP_STATUS_PRESSED;
	if (state.justpressed) word |= INP_STATUS_JUST_PRESSED;
	if (state.justreleased) word |= INP_STATUS_JUST_RELEASED;
	if (state.waspressed) word |= INP_STATUS_WAS_PRESSED;
	if (state.wasreleased) word |= INP_STATUS_WAS_RELEASED;
	if (state.consumed) word |= INP_STATUS_CONSUMED;
	if (state.alljustpressed) word |= INP_STATUS_ALL_JUST_PRESSED;
	if (state.alljustreleased) word |= INP_STATUS_ALL_JUST_RELEASED;
	if (state.allwaspressed) word |= INP_STATUS_ALL_WAS_PRESSED;
	if (actionFlag(state.guardedjustpressed)) word |= INP_STATUS_GUARDED_JUST_PRESSED;
	if (actionFlag(state.repeatpressed)) word |= INP_STATUS_REPEAT_PRESSED;
	word |= INP_STATUS_HAS_VALUE;
	return word;
}

inline u32 encodeInputActionValueQ16(const ActionState& state) {
	return encodeSignedFix16(state.value);
}

inline u32 encodeInputActionValueXQ16(const ActionState& state) {
	if (state.value2d.has_value()) {
		return encodeSignedFix16(state.value2d->x);
	}
	return 0u;
}

inline u32 encodeInputActionValueYQ16(const ActionState& state) {
	if (state.value2d.has_value()) {
		return encodeSignedFix16(state.value2d->y);
	}
	return 0u;
}

inline ActionState createInputActionSnapshot(const std::string& action, u32 statusWord, u32 valueQ16, f64 pressTime, u32 repeatCount) {
	ActionState state(action);
	state.pressed = (statusWord & INP_STATUS_PRESSED) != 0u;
	state.justpressed = (statusWord & INP_STATUS_JUST_PRESSED) != 0u;
	state.justreleased = (statusWord & INP_STATUS_JUST_RELEASED) != 0u;
	state.waspressed = (statusWord & INP_STATUS_WAS_PRESSED) != 0u;
	state.wasreleased = (statusWord & INP_STATUS_WAS_RELEASED) != 0u;
	state.consumed = (statusWord & INP_STATUS_CONSUMED) != 0u;
	state.alljustpressed = (statusWord & INP_STATUS_ALL_JUST_PRESSED) != 0u;
	state.alljustreleased = (statusWord & INP_STATUS_ALL_JUST_RELEASED) != 0u;
	state.allwaspressed = (statusWord & INP_STATUS_ALL_WAS_PRESSED) != 0u;
	state.guardedjustpressed = (statusWord & INP_STATUS_GUARDED_JUST_PRESSED) != 0u;
	state.repeatpressed = (statusWord & INP_STATUS_REPEAT_PRESSED) != 0u;
	state.repeatcount = static_cast<i32>(repeatCount);
	state.presstime = pressTime;
	if ((statusWord & INP_STATUS_HAS_VALUE) != 0u) {
		state.value = decodeSignedFix16(valueQ16);
	}
	return state;
}

} // namespace bmsx
