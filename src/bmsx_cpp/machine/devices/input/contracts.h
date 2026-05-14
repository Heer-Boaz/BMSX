#pragma once

#include "input/models.h"
#include "machine/common/numeric.h"

namespace bmsx {

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
