#include "input/manager.h"

#include "core/machine_manager.h"
#include "input/pointer_controls.h"

namespace bmsx {

Input& Input::instance() {
	static Input input;
	return input;
}

void Input::initialize() {
	Platform* platform = MachineManager::instance().platform();
	m_platformInputSub = platform->inputHub()->subscribe([this](const InputEvt& event) {
		handleInputEvent(event);
	});
}

void Input::shutdown() {
	m_platformInputSub.unsubscribe();
	resetInputState();
}

void Input::pollInput() {
	// Platform events arrive before this call. Keep a new wheel delta visible to
	// the current machine frame and clear it when the following host frame starts.
	if (m_pointerWheelPending) {
		m_pointerWheelPending = false;
	} else {
		m_pointerWheel = 0.0F;
	}
}

bool Input::keyboardUsagePressed(u8 usage) const {
	const size_t word = static_cast<size_t>(usage) >> 5u;
	return (m_keyboardUsageWords[word] & (1u << (static_cast<u32>(usage) & 31u))) != 0u;
}

bool Input::gamepadButtonPressed(u8 deviceSlot, GamepadButton button) const {
	return (m_gamepads[deviceSlot].buttons & (1u << static_cast<u32>(button))) != 0u;
}

void Input::sampleInputControllerSnapshot(f64, InputControllerSnapshot& snapshot) {
	snapshot.keyWords = m_keyboardUsageWords;
	snapshot.pointerButtons = m_pointerButtons;
	snapshot.pointerX = m_pointerX;
	snapshot.pointerY = m_pointerY;
	snapshot.pointerWheel = m_pointerWheel;
	snapshot.rumbleSupportMask = 0u;
	snapshot.pads = m_gamepads;
}

void Input::applyInputControllerVibrationEffect(i32, f64, f32) {
}

void Input::handleInputEvent(const InputEvt& event) {
	switch (event.type) {
		case InputEvtType::SupervisorRequestDown:
			m_supervisorRequestLineHigh = true;
			return;
		case InputEvtType::SupervisorRequestUp:
			m_supervisorRequestLineHigh = false;
			return;
		case InputEvtType::ButtonDown:
		case InputEvtType::ButtonUp: {
			const bool down = event.type == InputEvtType::ButtonDown;
			switch (event.input.source) {
				case InputSource::Keyboard: {
					const size_t word = static_cast<size_t>(event.input.control) >> 5u;
					const u32 mask = 1u << (static_cast<u32>(event.input.control) & 31u);
					m_keyboardUsageWords[word] = down
						? m_keyboardUsageWords[word] | mask
						: m_keyboardUsageWords[word] & ~mask;
					return;
				}
				case InputSource::Gamepad: {
					InputControllerPadSnapshot& gamepad = m_gamepads[event.input.deviceSlot];
					const GamepadButton button = static_cast<GamepadButton>(event.input.control);
					const u32 mask = 1u << static_cast<u32>(button);
					gamepad.buttons = down ? gamepad.buttons | mask : gamepad.buttons & ~mask;
					if (button == GamepadButton::LeftTrigger) {
						gamepad.axes[4] = down ? event.value : 0.0F;
					} else if (button == GamepadButton::RightTrigger) {
						gamepad.axes[5] = down ? event.value : 0.0F;
					}
					return;
				}
				case InputSource::Pointer: {
					const u32 mask = 1u << static_cast<u32>(event.input.control);
					m_pointerButtons = down ? m_pointerButtons | mask : m_pointerButtons & ~mask;
					return;
				}
			}
			return;
		}
		case InputEvtType::Axis1:
			m_pointerWheel = event.value;
			m_pointerWheelPending = true;
			return;
		case InputEvtType::Axis2:
			if (event.input.source == InputSource::Gamepad) {
				InputControllerPadSnapshot& gamepad = m_gamepads[event.input.deviceSlot];
				const size_t axis = static_cast<GamepadStick>(event.input.control) == GamepadStick::Left ? 0u : 2u;
				gamepad.axes[axis] = event.x;
				gamepad.axes[axis + 1u] = event.y;
			} else {
				m_pointerX = event.x;
				m_pointerY = event.y;
			}
			return;
	}
}

void Input::resetInputState() {
	m_keyboardUsageWords.fill(0u);
	m_gamepads.fill({});
	m_pointerButtons = 0u;
	m_pointerX = 0.0F;
	m_pointerY = 0.0F;
	m_pointerWheel = 0.0F;
	m_pointerWheelPending = false;
	m_supervisorRequestLineHigh = false;
}

} // namespace bmsx
