#pragma once

#include "bmsx_libretro.h"
#include "machine/devices/input/contracts.h"

#include <array>

namespace bmsx {

constexpr u8 HID_USAGE_KEY_C = 6u;
constexpr u8 HID_USAGE_KEY_X = 27u;
constexpr u8 HID_USAGE_ENTER = 40u;
constexpr u8 HID_USAGE_BACKSPACE = 42u;
constexpr u8 HID_USAGE_F2 = 59u;
constexpr u8 HID_USAGE_ARROW_RIGHT = 79u;
constexpr u8 HID_USAGE_ARROW_LEFT = 80u;
constexpr u8 HID_USAGE_ARROW_DOWN = 81u;
constexpr u8 HID_USAGE_ARROW_UP = 82u;
constexpr u8 HID_USAGE_SHIFT_LEFT = 225u;
constexpr u8 HID_USAGE_SHIFT_RIGHT = 229u;

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
	void reset();

	bool keyboardUsagePressed(u8 usage) const;
	bool gamepadButtonPressed(
		u8 deviceSlot,
		InputControllerGamepadButtonBit button) const;
	f64 frameDurationMs() const { return m_frame_duration_ms; }
	void setFrameDurationMs(f64 frameDurationMs) {
		m_frame_duration_ms = frameDurationMs;
	}

	void sampleInputControllerSnapshot(
		InputControllerSnapshot& snapshot) override;
	bool supervisorRequestLineHigh() const override {
		return m_host_supervisor_request_high
			|| m_keyboard_supervisor_request_high;
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
	std::array<InputControllerPadSnapshot, INPUT_CONTROLLER_PAD_COUNT> m_gamepads{};
	u32 m_pointer_buttons = 0u;
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
	bool m_keyboard_supervisor_request_high = false;
};

} // namespace bmsx
