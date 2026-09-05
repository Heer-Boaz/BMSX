#include "ui_input.h"
#include "input.h"
#include "hid_keys.h"
#include <bit>

namespace bmsx {
namespace {
// Same normalized host controls as Input.DEFAULT_INPUT_MAPPING.keyboard.
constexpr std::array<u8, INPUT_CONTROLLER_GAMEPAD_BUTTON_BIT_COUNT> keyboardUsages{
	hid_key_usage::X, hid_key_usage::C, hid_key_usage::Z, hid_key_usage::S,
	hid_key_usage::ShiftLeft, hid_key_usage::ShiftRight, hid_key_usage::ControlLeft, hid_key_usage::AltLeft,
	hid_key_usage::ControlRight, hid_key_usage::AltRight, hid_key_usage::Q, hid_key_usage::E,
	hid_key_usage::ArrowUp, hid_key_usage::ArrowDown, hid_key_usage::ArrowLeft, hid_key_usage::ArrowRight,
	hid_key_usage::Escape, hid_key_usage::Space,
};
}
HostUiInput::HostUiInput(LibretroInput& input) : input(input) {}
void HostUiInput::reset(u8 nextSources, u32 nextKeyboardButtons) {
	consumeSources(sources | nextSources, keyboardButtons | nextKeyboardButtons);
	sources = nextSources;
	keyboardButtons = nextKeyboardButtons;
	buttons.fill(0);
	blocked.fill((1u << ButtonCount) - 1u);
	pressedEdges.fill(0);
	repeatEdges.fill(0);
	for (auto& repeat : repeats) repeat.reset();
	pointerTarget = -1;
	pointerValid = false;
	pointerChanged = false;
	pointerDown = false;
	pointerPressed = false;
	pointerReleased = false;
	pointerBlocked = true;
}
void HostUiInput::update(f64 currentTimeMs) {
	if (sources == HostUiInputSource::None) return;
	++frameId;
	u32 keyboard = 0;
	if ((sources & HostUiInputSource::Keyboard) != 0) {
		for (size_t button = 0; button < ButtonCount; ++button) {
			const u32 mask = 1u << button;
			if ((keyboardButtons & mask) != 0 && input.physicalKeyboardUsagePressed(keyboardUsages[button])) keyboard |= mask;
		}
	}
	updateButtons(0, keyboard, currentTimeMs, input.frameDurationMs(), frameId);
	for (u8 player = 0; player < INPUT_CONTROLLER_PAD_COUNT; ++player) {
		u32 physicalButtons = 0;
		if ((sources & HostUiInputSource::Gamepad) != 0) {
			physicalButtons = input.physicalGamepadButtonsWord(player);
			if ((sources & HostUiInputSource::LeftStick) != 0) {
				const i32 x = toSignedWord(input.physicalGamepadAxisWord(player, InputControllerGamepadAxis::LeftX));
				const i32 y = toSignedWord(input.physicalGamepadAxisWord(player, InputControllerGamepadAxis::LeftY));
				if (x <= -0x8000) physicalButtons |= 1u << static_cast<u32>(InputControllerGamepadButtonBit::Left);
				if (x >= 0x8000) physicalButtons |= 1u << static_cast<u32>(InputControllerGamepadButtonBit::Right);
				if (y <= -0x8000) physicalButtons |= 1u << static_cast<u32>(InputControllerGamepadButtonBit::Up);
				if (y >= 0x8000) physicalButtons |= 1u << static_cast<u32>(InputControllerGamepadButtonBit::Down);
			}
		}
		updateButtons(player + 1, physicalButtons, currentTimeMs, input.frameDurationMs(), frameId);
	}
	if ((sources & HostUiInputSource::Pointer) != 0) {
		const i32 x = pointerX, y = pointerY;
		const bool valid = pointerValid;
		pointerValid = input.pointerPosition(pointerX, pointerY);
		const bool physicalDown = input.pointerButtonPressed(INP_POINTER_BUTTON_PRIMARY);
		pointerBlocked = pointerBlocked && physicalDown;
		const bool down = physicalDown && !pointerBlocked;
		pointerPressed = down && !pointerDown;
		pointerReleased = !down && pointerDown;
		pointerDown = down;
		pointerChanged = valid != pointerValid || x != pointerX || y != pointerY || pointerPressed || pointerReleased;
	}
}
void HostUiInput::updateButtons(size_t source, u32 physicalButtons, f64 now, f64 frameDurationMs, i64 frameId) {
	blocked[source] &= physicalButtons;
	const u32 eligible = physicalButtons & ~blocked[source];
	const u32 edges = eligible & ~buttons[source];
	u32 work = eligible | (buttons[source] & ~physicalButtons);
	buttons[source] = physicalButtons;
	pressedEdges[source] = edges;
	u32 repeating = 0;
	while (work != 0) {
		const auto button = std::countr_zero(work);
		const u32 mask = 1u << button;
		work &= work - 1;
		if (repeats[source * ButtonCount + button].update((eligible & mask) != 0, (edges & mask) != 0, now, now, frameDurationMs, frameId)) repeating |= mask;
	}
	repeatEdges[source] = repeating;
}
bool HostUiInput::buttonJustPressed(InputControllerGamepadButtonBit button) const {
	const u32 mask = 1u << static_cast<u32>(button);
	for (u32 edges : pressedEdges) if ((edges & mask) != 0) return true;
	return false;
}
bool HostUiInput::buttonRepeatEdge(InputControllerGamepadButtonBit button) const {
	const u32 mask = 1u << static_cast<u32>(button);
	for (u32 edges : repeatEdges) if ((edges & mask) != 0) return true;
	return false;
}
bool HostUiInput::gamepadButtonPressed(u8 player, InputControllerGamepadButtonBit button) const { return (buttons[player + 1] & (1u << static_cast<u32>(button))) != 0; }
bool HostUiInput::gamepadButtonJustPressed(u8 player, InputControllerGamepadButtonBit button) const { return (pressedEdges[player + 1] & (1u << static_cast<u32>(button))) != 0; }
bool HostUiInput::gamepadButtonRepeatEdge(u8 player, InputControllerGamepadButtonBit button) const { return (repeatEdges[player + 1] & (1u << static_cast<u32>(button))) != 0; }
bool HostUiInput::activatePointer(i32 target) {
	if (pointerPressed) pointerTarget = target;
	if (!pointerReleased) return false;
	const bool activated = target >= 0 && target == pointerTarget;
	pointerTarget = -1;
	return activated;
}
void HostUiInput::consume() const { consumeSources(sources, keyboardButtons); }
void HostUiInput::consumeSources(u8 sources, u32 keyboardButtons) const {
	if ((sources & HostUiInputSource::Gamepad) != 0) {
		for (u8 player = 0; player < INPUT_CONTROLLER_PAD_COUNT; ++player) input.consumeGamepadInput(player);
	}
	if ((sources & HostUiInputSource::Keyboard) != 0) {
		for (size_t button = 0; button < ButtonCount; ++button) if ((keyboardButtons & (1u << button)) != 0) input.consumePhysicalKeyboardUsage(keyboardUsages[button]);
	}
	if ((sources & HostUiInputSource::Pointer) != 0) input.consumePointerButton(INP_POINTER_BUTTON_PRIMARY);
}
} // namespace bmsx
