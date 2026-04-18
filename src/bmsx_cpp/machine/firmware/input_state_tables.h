#pragma once

#include "machine/cpu/cpu.h"
#include "input/models.h"

namespace bmsx {

class Runtime;

struct InputStateTableKeys {
	Value pressed = valueNil();
	Value justpressed = valueNil();
	Value justreleased = valueNil();
	Value waspressed = valueNil();
	Value wasreleased = valueNil();
	Value repeatpressed = valueNil();
	Value repeatcount = valueNil();
	Value consumed = valueNil();
	Value presstime = valueNil();
	Value timestamp = valueNil();
	Value pressedAtMs = valueNil();
	Value releasedAtMs = valueNil();
	Value pressId = valueNil();
	Value value = valueNil();
	Value value2d = valueNil();
	Value x = valueNil();
	Value y = valueNil();
};

constexpr uint32_t ACTION_STATE_FLAG_PRESSED = 1u << 0u;
constexpr uint32_t ACTION_STATE_FLAG_JUSTPRESSED = 1u << 1u;
constexpr uint32_t ACTION_STATE_FLAG_JUSTRELEASED = 1u << 2u;
constexpr uint32_t ACTION_STATE_FLAG_WASPRESSED = 1u << 3u;
constexpr uint32_t ACTION_STATE_FLAG_WASRELEASED = 1u << 4u;
constexpr uint32_t ACTION_STATE_FLAG_CONSUMED = 1u << 5u;
constexpr uint32_t ACTION_STATE_FLAG_ALLJUSTPRESSED = 1u << 6u;
constexpr uint32_t ACTION_STATE_FLAG_ALLWASPRESSED = 1u << 7u;
constexpr uint32_t ACTION_STATE_FLAG_ALLJUSTRELEASED = 1u << 8u;
constexpr uint32_t ACTION_STATE_FLAG_GUARDEDJUSTPRESSED = 1u << 9u;
constexpr uint32_t ACTION_STATE_FLAG_REPEATPRESSED = 1u << 10u;

InputStateTableKeys createInputStateTableKeys(Runtime& runtime);
uint32_t packActionStateFlags(const ActionState& state);
Value buildButtonStateTable(Runtime& runtime, const InputStateTableKeys& keys, const ButtonState& state, bool repeatPressed, int repeatCount);

} // namespace bmsx
