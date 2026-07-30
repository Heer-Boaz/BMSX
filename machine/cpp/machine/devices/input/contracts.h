#pragma once

#include "machine/common/numeric.h"

#include <array>

namespace bmsx {

// Raw ICU snapshot contract. The ICU latches one full input snapshot per armed
// VBlank edge into plain MMIO words; it carries no key names, mappings, or
// action semantics. Keyboard bits are indexed by USB HID usage IDs
// (usage page 0x07); pad button bits use InputControllerGamepadButtonBit.
// Mirrors machine/ts/machine/devices/input/contracts.ts.

constexpr int INPUT_CONTROLLER_KEY_WORD_COUNT = 8; // 256 HID usage bits
constexpr int INPUT_CONTROLLER_PAD_COUNT = 4;
constexpr int INPUT_CONTROLLER_PAD_AXIS_COUNT = 6; // lx, ly, rx, ry, lt, rt

// Raw bit positions in each latched pad-buttons word.
enum class InputControllerGamepadButtonBit : u8 {
	A = 0,
	B = 1,
	X = 2,
	Y = 3,
	LeftBumper = 4,
	RightBumper = 5,
	LeftTrigger = 6,
	RightTrigger = 7,
	Select = 8,
	Start = 9,
	LeftStick = 10,
	RightStick = 11,
	Up = 12,
	Down = 13,
	Left = 14,
	Right = 15,
	Home = 16,
	Touchpad = 17,
};
constexpr int INPUT_CONTROLLER_GAMEPAD_BUTTON_BIT_COUNT =
	static_cast<int>(InputControllerGamepadButtonBit::Touchpad) + 1;

// Pointer button bit order mirrors the W3C MouseEvent.button index order.
constexpr int INP_POINTER_BUTTON_PRIMARY = 0;
constexpr int INP_POINTER_BUTTON_AUX = 1;
constexpr int INP_POINTER_BUTTON_SECONDARY = 2;
constexpr int INP_POINTER_BUTTON_BACK = 3;
constexpr int INP_POINTER_BUTTON_FORWARD = 4;

struct InputControllerPadSnapshot {
	u32 buttons = 0;
	std::array<f32, INPUT_CONTROLLER_PAD_AXIS_COUNT> axes{}; // sticks in [-1,1], triggers in [0,1]
};

struct InputControllerSnapshot {
	std::array<u32, INPUT_CONTROLLER_KEY_WORD_COUNT> keyWords{}; // bit = HID usage pressed
	u32 pointerButtons = 0;
	f32 pointerX = 0.0F; // host pointer-space coordinates
	f32 pointerY = 0.0F;
	f32 pointerWheel = 0.0F;
	u32 rumbleSupportMask = 0; // bit per pad
	std::array<InputControllerPadSnapshot, INPUT_CONTROLLER_PAD_COUNT> pads{};
};

inline InputControllerSnapshot createInputControllerSnapshot() {
	return InputControllerSnapshot{};
}

class InputControllerInputSource {
public:
	virtual ~InputControllerInputSource() = default;
	virtual void sampleInputControllerSnapshot(InputControllerSnapshot& snapshot) = 0;
	virtual auto supervisorRequestLineHigh() const -> bool = 0;
	virtual void applyInputControllerVibrationEffect(i32 padIndex, f64 durationMs, f32 intensity) = 0;
};

constexpr u32 INPUT_CONTROLLER_OUTPUT_INTENSITY_Q16_ONE = static_cast<u32>(FIX16_ONE);
constexpr u32 INP_OUTPUT_CTRL_APPLY = 1u;

inline f32 decodeInputOutputIntensityQ16(u32 value) {
	return static_cast<f32>(value) / static_cast<f32>(INPUT_CONTROLLER_OUTPUT_INTENSITY_Q16_ONE);
}

} // namespace bmsx
