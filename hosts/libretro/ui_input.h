#pragma once
#include "button_repeat.h"
#include "machine/devices/input/contracts.h"
#include <array>

namespace bmsx {
class LibretroInput;
namespace HostUiInputSource {
constexpr u8 None = 0, Keyboard = 1, Gamepad = 2, LeftStick = 4, Pointer = 8;
}
class HostUiInput {
public:
	i32 pointerX = 0, pointerY = 0;
	bool pointerValid = false, pointerChanged = false;
	explicit HostUiInput(LibretroInput& input);
	void reset(u8 nextSources, u32 nextKeyboardButtons);
	void update(f64 currentTimeMs);
	bool buttonJustPressed(InputControllerGamepadButtonBit button) const;
	bool buttonRepeatEdge(InputControllerGamepadButtonBit button) const;
	bool gamepadButtonPressed(u8 player, InputControllerGamepadButtonBit button) const;
	bool gamepadButtonJustPressed(u8 player, InputControllerGamepadButtonBit button) const;
	bool gamepadButtonRepeatEdge(u8 player, InputControllerGamepadButtonBit button) const;
	bool activatePointer(i32 target);
	void consume() const;
private:
	static constexpr size_t SourceCount = INPUT_CONTROLLER_PAD_COUNT + 1;
	static constexpr size_t ButtonCount = INPUT_CONTROLLER_GAMEPAD_BUTTON_BIT_COUNT;
	void updateButtons(size_t source, u32 physicalButtons, f64 now, f64 frameDurationMs, i64 frameId);
	void consumeSources(u8 sources, u32 keyboardButtons) const;
	LibretroInput& input;
	bool pointerDown = false, pointerPressed = false, pointerReleased = false, pointerBlocked = false;
	i32 pointerTarget = -1;
	u8 sources = HostUiInputSource::None;
	u32 keyboardButtons = 0;
	i64 frameId = 0;
	std::array<u32, SourceCount> buttons{}, blocked{}, pressedEdges{}, repeatEdges{};
	std::array<ButtonRepeat, SourceCount * ButtonCount> repeats;
};
} // namespace bmsx
