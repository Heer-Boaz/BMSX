#pragma once

#include "common/subscription.h"
#include "input/gamepad_buttons.h"
#include "machine/runtime/input.h"
#include "platform/input.h"

#include <array>

namespace bmsx {

class Input final : public RuntimeInputSource {
public:
	static Input& instance();

	void initialize();
	void shutdown();
	void resetInputState();
	void pollInput();

	bool keyboardUsagePressed(u8 usage) const;
	bool gamepadButtonPressed(u8 deviceSlot, GamepadButton button) const;

	void sampleInputControllerSnapshot(f64 currentTimeMs, InputControllerSnapshot& snapshot) override;
	bool supervisorRequestLineHigh() const override { return m_supervisorRequestLineHigh; }
	void applyInputControllerVibrationEffect(i32 padIndex, f64 durationMs, f32 intensity) override;
	void setRuntimeInputFrameDurationMs(f64 frameDurationMs) override { m_frameDurationMs = frameDurationMs; }
	f64 frameDurationMs() const { return m_frameDurationMs; }

private:
	Input() = default;
	Input(const Input&) = delete;
	Input& operator=(const Input&) = delete;

	void handleInputEvent(const InputEvt& event);

	std::array<u32, INPUT_CONTROLLER_KEY_WORD_COUNT> m_keyboardUsageWords{};
	std::array<InputControllerPadSnapshot, INPUT_CONTROLLER_PAD_COUNT> m_gamepads{};
	u32 m_pointerButtons = 0u;
	f32 m_pointerX = 0.0F;
	f32 m_pointerY = 0.0F;
	f32 m_pointerWheel = 0.0F;
	bool m_pointerWheelPending = false;
	SubscriptionHandle m_platformInputSub;
	bool m_supervisorRequestLineHigh = false;
	f64 m_frameDurationMs = 1000.0 / 60.0;
};

} // namespace bmsx
