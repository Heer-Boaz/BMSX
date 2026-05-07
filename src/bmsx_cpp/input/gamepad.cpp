/*
 * gamepad.cpp - Gamepad input handler implementation
 */

#include "gamepad.h"
#include "manager.h"
#include "core/console.h"
#include <cmath>

namespace bmsx {

/* ============================================================================
 * Constructor / Destructor
 * ============================================================================ */

GamepadInput::GamepadInput(const std::string& deviceId, const std::string& description)
	: m_deviceId(deviceId)
	, m_description(description)
{
	reset();
}

GamepadInput::~GamepadInput() {
	dispose();
}

/* ============================================================================
 * InputHandler interface
 * ============================================================================ */

void GamepadInput::pollInput() {
	// This is called each frame to update edge flags and press times
	// The actual button state changes come from ingestButton/ingestAxis2
	
	f64 now = ConsoleCore::instance().clock()->now();
	f64 prevPollTime = m_lastPollTimeMs;
	m_lastPollTimeMs = now;
	
	for (auto& [key, state] : m_buttonStates) {
		if (state.pressed) {
			// Update press time
			f64 pressedAt = buttonPressedAtOr(state, now);
			state.presstime = std::max(0.0, now - pressedAt);
			
			// Clear edge flags if they've been processed
			if (prevPollTime > 0 && state.justpressed && 
				buttonTimestampOr(state, 0.0) <= prevPollTime) {
				state.justpressed = false;
			}
			state.justreleased = false;
		} else {
			state.presstime = std::nullopt;
			
			// Clear edge flags if they've been processed
			if (prevPollTime > 0 && state.justreleased &&
				buttonTimestampOr(state, 0.0) <= prevPollTime) {
				state.justreleased = false;
			}
			state.justpressed = false;
		}
	}
}

ButtonState GamepadInput::getButtonState(const ButtonId& button) {
	auto it = m_buttonStates.find(button);
	if (it == m_buttonStates.end()) {
		return ButtonState{};
	}
	return it->second;
}

void GamepadInput::consumeButton(const ButtonId& button) {
	auto it = m_buttonStates.find(button);
	if (it != m_buttonStates.end()) {
		it->second.consumed = true;
	}
}

void GamepadInput::reset(const std::vector<std::string>* except) {
	if (!except) {
		m_buttonStates.clear();
		m_lastPollTimeMs = 0.0;
		return;
	}
	resetObject(m_buttonStates, except);
}

i32 GamepadInput::gamepadIndex() const {
	// Extract index from device ID (format: "gamepad:N")
	size_t colonPos = m_deviceId.find(':');
	if (colonPos == std::string::npos || colonPos + 1 >= m_deviceId.size()) {
		return -1;
	}

	i32 index = 0;
	for (size_t i = colonPos + 1; i < m_deviceId.size(); i++) {
		const char ch = m_deviceId[i];
		if (ch < '0' || ch > '9') {
			return -1;
		}
		index = index * 10 + static_cast<i32>(ch - '0');
	}
	return index;
}

bool GamepadInput::supportsVibrationEffect() const {
	return m_vibrationSupported && m_vibrationCallback;
}

void GamepadInput::applyVibrationEffect(const VibrationParams& params) {
	if (!supportsVibrationEffect()) return;
	m_vibrationCallback(params.intensity, params.duration);
}

void GamepadInput::dispose() {
	reset();
}

/* ============================================================================
 * Button/Axis ingestion
 * ============================================================================ */

void GamepadInput::ingestButton(const std::string& code, bool down, f32 value,
									f64 timestamp, std::optional<i32> pressId) {
	auto& state = m_buttonStates[code];
	
	if (down) {
		i32 existingPressId = resolveButtonPressId(pressId, state, m_nextPressId);
		state.pressed = true;
		state.justpressed = true;
		state.justreleased = false;
		state.waspressed = true;
		state.timestamp = timestamp;
		state.pressedAtMs = timestamp;
		state.value = value;
		state.pressId = existingPressId;
	} else {
		bool wasPressed = state.pressed;
		state.justreleased = wasPressed;
		state.pressed = false;
		state.justpressed = false;
		state.timestamp = timestamp;
		state.releasedAtMs = timestamp;
		state.value = 0.0f;
		state.waspressed = state.waspressed || wasPressed;
		state.wasreleased = state.wasreleased || wasPressed;
		if (pressId.has_value()) {
			state.pressId = pressId;
		}
		state.consumed = false;
	}
}

void GamepadInput::ingestAxis2(const std::string& code, f32 x, f32 y, f64 timestamp) {
	auto& state = m_buttonStates[code];
	state.value2d = Vec2{x, y};
	state.value = std::hypot(x, y);
	state.timestamp = timestamp;
}

} // namespace bmsx
