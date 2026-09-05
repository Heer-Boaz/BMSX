#include "ui_input.h"
#include "input.h"
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
	pointerDown = false; tick();
	require(!ui.activatePointer(4), "transition discards capture, even with the same destination target id");
	pointerDown = true; tick();
	require(!ui.activatePointer(4), "fresh pointer press");
	pointerDown = false; tick();
	require(ui.activatePointer(4), "fresh pointer release activates destination");
	std::cout << "HOST-UI-INPUT:PASS\n";
}
