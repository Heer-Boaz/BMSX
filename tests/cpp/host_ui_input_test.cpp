#include "ui_input.h"
#include "input.h"
#include "hid_keys.h"
#include <iostream>
#include <stdexcept>

namespace {
using namespace bmsx;
u16 buttons = 0;
i16 stickX = 0;
bool pointerDown = false;
void poll() {}
bool RETRO_CALLCONV supervisor() { return false; }
i16 state(unsigned port, unsigned device, unsigned index, unsigned id) {
	if (port != 0) return 0;
	if (device == RETRO_DEVICE_POINTER && id == RETRO_DEVICE_ID_POINTER_PRESSED) return pointerDown ? 1 : 0;
	if (device == RETRO_DEVICE_JOYPAD) return (buttons & (1u << id)) != 0 ? 1 : 0;
	if (device == RETRO_DEVICE_ANALOG && index == RETRO_DEVICE_INDEX_ANALOG_LEFT && id == RETRO_DEVICE_ID_ANALOG_X) return stickX;
	return 0;
}
void require(bool condition, const char* message) { if (!condition) throw std::runtime_error(message); }
}
int main() {
	LibretroInput input(supervisor);
	input.setInputPollCallback(poll);
	input.setInputStateCallback(state);
	input.setControllerDevice(0, RETRO_DEVICE_JOYPAD);
	input.setFrameDurationMs(20);
	HostUiInput ui(input);
	ui.reset(HostUiInputSource::Gamepad | HostUiInputSource::LeftStick, 0);
	f64 time = 0;
	const auto tick = [&]() { time += 20; input.poll(256, 212, time); ui.update(time); };
	tick();
	buttons = 1u << RETRO_DEVICE_ID_JOYPAD_L; tick();
	require(ui.buttonJustPressed(InputControllerGamepadButtonBit::LeftBumper), "physical press edge");
	require(ui.buttonRepeatEdge(InputControllerGamepadButtonBit::LeftBumper), "repeat includes first press");
	for (int frame = 1; frame < 15; ++frame) { tick(); require(!ui.buttonRepeatEdge(InputControllerGamepadButtonBit::LeftBumper), "initial repeat delay"); }
	tick();
	require(ui.buttonRepeatEdge(InputControllerGamepadButtonBit::LeftBumper), "repeat deadline");
	require(ui.buttonRepeatEdge(InputControllerGamepadButtonBit::LeftBumper), "same-frame repeat query");
	ui.consume();
	require(ui.gamepadButtonPressed(0, InputControllerGamepadButtonBit::LeftBumper), "consumption is not physical release");
	ui.reset(HostUiInputSource::Gamepad | HostUiInputSource::LeftStick, 0);
	for (int frame = 0; frame < 40; ++frame) {
		tick();
		require(!ui.buttonJustPressed(InputControllerGamepadButtonBit::LeftBumper) && !ui.buttonRepeatEdge(InputControllerGamepadButtonBit::LeftBumper), "reset suppresses held input until release");
	}
	buttons = 0; tick();
	buttons = 1u << RETRO_DEVICE_ID_JOYPAD_L; tick();
	require(ui.buttonJustPressed(InputControllerGamepadButtonBit::LeftBumper), "new physical press after reset");
	stickX = 32767; tick();
	require(ui.buttonJustPressed(InputControllerGamepadButtonBit::Right), "stick participates in chosen input context");
	ui.reset(HostUiInputSource::Gamepad | HostUiInputSource::LeftStick, 0);
	for (int frame = 0; frame < 20; ++frame) { tick(); require(!ui.buttonRepeatEdge(InputControllerGamepadButtonBit::Right), "held stick is suppressed across transition"); }
	ui.reset(HostUiInputSource::Pointer, 0); tick();
	pointerDown = true; tick();
	require(!ui.activatePointer(4), "pointer activation waits for release");
	ui.reset(HostUiInputSource::Pointer, 0); tick();
	require(!ui.pointerChanged, "a page transition is not physical pointer movement");
	pointerDown = false; tick();
	require(!ui.activatePointer(4), "transition discards capture, even with the same destination target id");
	pointerDown = true; tick();
	require(!ui.activatePointer(4), "fresh pointer press");
	pointerDown = false; tick();
	require(ui.activatePointer(4), "fresh pointer release activates destination");
	const u32 keyboardActions = (1u << static_cast<u32>(InputControllerGamepadButtonBit::A))
		| (1u << static_cast<u32>(InputControllerGamepadButtonBit::B)) | (1u << static_cast<u32>(InputControllerGamepadButtonBit::X));
	ui.reset(HostUiInputSource::Keyboard, keyboardActions); tick();
	for (const auto [key, action] : std::array{
		std::pair{RETROK_RETURN, InputControllerGamepadButtonBit::A},
		std::pair{RETROK_KP_ENTER, InputControllerGamepadButtonBit::A},
		std::pair{RETROK_ESCAPE, InputControllerGamepadButtonBit::B},
		std::pair{RETROK_SPACE, InputControllerGamepadButtonBit::X}}) {
		input.postKeyboardEvent(key, true); tick();
		require(ui.buttonJustPressed(action), "physical keyboard UI action");
		ui.reset(HostUiInputSource::Keyboard, keyboardActions); tick();
		require(!ui.buttonJustPressed(action), "held keyboard action cannot accept a new page");
		input.postKeyboardEvent(key, false); tick(); input.postKeyboardEvent(key, true); tick();
		require(ui.buttonJustPressed(action), "new keyboard action after release");
		input.postKeyboardEvent(key, false); tick();
	}
	// Focus exit retains only the held physical button/key/pointer identities.
	buttons = 0; stickX = 0; pointerDown = false;
	ui.reset(HostUiInputSource::Keyboard | HostUiInputSource::Gamepad | HostUiInputSource::Pointer, keyboardActions);
	tick(); ui.consume();
	buttons = (1u << RETRO_DEVICE_ID_JOYPAD_A) | (1u << RETRO_DEVICE_ID_JOYPAD_L2) | (1u << RETRO_DEVICE_ID_JOYPAD_L3);
	stickX = 32767; pointerDown = true; input.postKeyboardEvent(RETROK_RETURN, true);
	tick(); ui.consume();
	ui.reset(HostUiInputSource::None, 0);
	InputControllerSnapshot snapshot{};
	const auto keyPressed = [&](u8 usage) { return (snapshot.keyWords[usage >> 5] & (1u << (usage & 31))) != 0; };
	for (int frame = 0; frame < 15; ++frame) {
		tick(); ui.consume(); input.sampleInputControllerSnapshot(snapshot, InputControllerSampleContext::Normal);
		require((input.physicalGamepadButtonsWord(0) & (1u << static_cast<u32>(InputControllerGamepadButtonBit::A))) != 0, "exit consumption is not a physical release");
		require(snapshot.pads[0].buttons == 0 && snapshot.pointerButtons == 0 && !keyPressed(hid_key_usage::Enter), "held inputs stay consumed across subsequent polls after closing");
		require(snapshot.pads[0].axesQ16[static_cast<size_t>(InputControllerGamepadAxis::LeftX)] == 0x10000u, "button exit ownership leaves stick axes independent");
		require(snapshot.pads[0].axesQ16[static_cast<size_t>(InputControllerGamepadAxis::LeftTrigger)] == 0x10000u, "button exit ownership leaves trigger axes independent");
	}
	buttons |= 1u << RETRO_DEVICE_ID_JOYPAD_B; input.postKeyboardEvent(RETROK_KP_ENTER, true);
	tick(); ui.consume(); input.sampleInputControllerSnapshot(snapshot, InputControllerSampleContext::Normal);
	require(snapshot.pads[0].buttons == (1u << static_cast<u32>(InputControllerGamepadButtonBit::B)), "fresh button remains independent of captured holds");
	require(!keyPressed(hid_key_usage::Enter) && keyPressed(hid_key_usage::NumpadEnter), "Enter aliases retain distinct physical identities");
	buttons &= ~(1u << RETRO_DEVICE_ID_JOYPAD_A); input.postKeyboardEvent(RETROK_RETURN, false); pointerDown = false;
	tick(); ui.consume();
	buttons |= 1u << RETRO_DEVICE_ID_JOYPAD_A; input.postKeyboardEvent(RETROK_RETURN, true); pointerDown = true;
	tick(); ui.consume(); input.sampleInputControllerSnapshot(snapshot, InputControllerSampleContext::Normal);
	require(snapshot.pads[0].buttons == ((1u << static_cast<u32>(InputControllerGamepadButtonBit::A)) | (1u << static_cast<u32>(InputControllerGamepadButtonBit::B))), "real up rearms only its own button");
	require(keyPressed(hid_key_usage::Enter) && keyPressed(hid_key_usage::NumpadEnter) && snapshot.pointerButtons != 0, "new keyboard and pointer presses route normally");
	std::cout << "HOST-UI-INPUT:PASS\n";
}
