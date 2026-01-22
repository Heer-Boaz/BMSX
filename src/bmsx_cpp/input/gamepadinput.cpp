/*
 * gamepadinput.cpp - Gamepad input handler implementation
 *
 * Mirrors TypeScript input/gamepad.ts
 */

#include "gamepadinput.h"
#include "input.h"
#include "../core/engine_core.h"
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
	
	f64 now = EngineCore::instance().clock()->now();
	f64 prevPollTime = m_lastPollTimeMs;
	m_lastPollTimeMs = now;
	
	for (auto& [key, state] : m_buttonStates) {
		if (state.pressed) {
			// Update press time
			f64 pressedAt = state.pressedAtMs.value_or(state.timestamp.value_or(now));
			state.presstime = std::max(0.0, now - pressedAt);
			
			// Clear edge flags if they've been processed
			if (prevPollTime > 0 && state.justpressed && 
				state.timestamp.value_or(0) <= prevPollTime) {
				state.justpressed = false;
			}
			state.justreleased = false;
		} else {
			state.presstime = std::nullopt;
			
			// Clear edge flags if they've been processed
			if (prevPollTime > 0 && state.justreleased &&
				state.timestamp.value_or(0) <= prevPollTime) {
				state.justreleased = false;
			}
			state.justpressed = false;
		}
		
		// Ensure consumed flag is properly initialized
		if (state.consumed != true) {
			state.consumed = false;
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
	resetObjectMap(m_buttonStates, except);
}

i32 GamepadInput::gamepadIndex() const {
	// Extract index from device ID (format: "gamepad:N")
	size_t colonPos = m_deviceId.find(':');
	if (colonPos != std::string::npos && colonPos + 1 < m_deviceId.size()) {
		try {
			return std::stoi(m_deviceId.substr(colonPos + 1));
		} catch (...) {
			return -1;
		}
	}
	return -1;
}

bool GamepadInput::supportsVibrationEffect() const {
	return m_vibrationSupported && m_vibrationCallback;
}

void GamepadInput::applyVibrationEffect(const VibrationParams& params) {
	if (!supportsVibrationEffect()) return;
	
	if (m_vibrationCallback) {
		m_vibrationCallback(params.intensity, params.duration);
	}
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
		i32 existingPressId = pressId.value_or(state.pressId.value_or(m_nextPressId++));
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
	state.value2d = Vec2(x, y);
	state.value = std::hypot(x, y);
	state.timestamp = timestamp;
}

} // namespace bmsx
