#pragma once

#include "bmsx_libretro.h"
#include "host_shortcuts.h"
#include "machine/devices/input/contracts.h"

#include <array>

namespace bmsx {

class LibretroInput final : public InputControllerInputSource {
public:
	explicit LibretroInput(
		bmsx_supervisor_request_line_t supervisorRequestLine);

	void poll(i32 viewportWidth, i32 viewportHeight, f64 currentTimeMs);
	void setInputPollCallback(retro_input_poll_t callback) { m_input_poll_callback = callback; }
	void setInputStateCallback(retro_input_state_t callback) { m_input_state_callback = callback; }
	void installRumbleInterface(retro_rumble_interface rumbleInterface);
	void setControllerDevice(unsigned port, unsigned device);
	void postKeyboardEvent(unsigned keycode, bool down);
	void setVirtualKeyboardKey(u8 usage, bool down);
	void reset();

	bool physicalKeyboardUsagePressed(u8 usage) const;
	void consumePhysicalKeyboardUsage(u8 usage);
	bool gamepadButtonPressed(
		u8 deviceSlot,
		InputControllerGamepadButtonBit button) const;
	u32 physicalGamepadButtonsWord(u8 deviceSlot) const;
	u32 physicalGamepadAxisWord(u8 deviceSlot, u8 axis) const;
	void consumeGamepadButton(
		u8 deviceSlot,
		InputControllerGamepadButtonBit button);
	void consumeGamepadInput(u8 deviceSlot);
	void setExclusiveGamepadHostShortcut(InputControllerGamepadButtonBit button);
	void clearExclusiveGamepadHostShortcut();
	bool pointerPosition(i32& x, i32& y) const;
	bool pointerButtonPressed(u32 button) const;
	void consumePointerButton(u32 button);
	bool hostShortcutJustPressed(InputControllerGamepadButtonBit button) const;
	f64 frameDurationMs() const { return m_frame_duration_ms; }
	void setFrameDurationMs(f64 frameDurationMs) {
		m_frame_duration_ms = frameDurationMs;
	}

	void sampleInputControllerSnapshot(
		InputControllerSnapshot& snapshot) override;
	bool supervisorRequestLineHigh() const override {
		return m_host_supervisor_request_high;
	}
	void applyInputControllerVibrationEffect(
		i32 padIndex,
		f64 durationMs,
		f32 intensity) override;

private:
	bool setRumbleStrength(unsigned port, u16 strength);

	bmsx_supervisor_request_line_t m_supervisor_request_line;
	retro_input_poll_t m_input_poll_callback = nullptr;
	retro_input_state_t m_input_state_callback = nullptr;
	retro_rumble_interface m_rumble_interface{};
	std::array<unsigned, INPUT_CONTROLLER_PAD_COUNT> m_controller_devices{};
	std::array<f64, INPUT_CONTROLLER_PAD_COUNT> m_rumble_deadlines_ms{};
	std::array<u32, INPUT_CONTROLLER_KEY_WORD_COUNT> m_keyboard_usage_words{};
	std::array<u32, INPUT_CONTROLLER_KEY_WORD_COUNT> m_virtual_keyboard_usage_words{};
	std::array<u32, INPUT_CONTROLLER_KEY_WORD_COUNT> m_routed_keyboard_usage_words{};
	std::array<u32, INPUT_CONTROLLER_PAD_COUNT> m_physical_gamepad_buttons{};
	std::array<std::array<u32, INPUT_CONTROLLER_PAD_AXIS_COUNT>, INPUT_CONTROLLER_PAD_COUNT>
		m_physical_gamepad_axes_q16{};
	std::array<InputControllerPadSnapshot, INPUT_CONTROLLER_PAD_COUNT> m_gamepads{};
	u32 m_pointer_buttons = 0u;
	u32 m_routed_pointer_buttons = 0u;
	i32 m_pointer_x = 0;
	i32 m_pointer_y = 0;
	u32 m_pointer_x_q16 = 0u;
	u32 m_pointer_y_q16 = 0u;
	u32 m_pointer_wheel_q16 = 0u;
	u32 m_rumble_support_mask = 0u;
	u32 m_active_rumble_mask = 0u;
	f64 m_current_time_ms = 0.0;
	f64 m_frame_duration_ms = 1000.0 / 60.0;
	bool m_pointer_position_valid = false;
	bool m_host_supervisor_request_high = false;
	std::array<BmsxHostShortcutState, INPUT_CONTROLLER_PAD_COUNT>
		m_gamepad_shortcuts{};
	BmsxHostShortcutState m_keyboard_shortcuts{};
	u32 m_gamepad_host_shortcut_targets = 0u;
	u32 m_just_pressed_host_shortcuts = 0u;
};

} // namespace bmsx
