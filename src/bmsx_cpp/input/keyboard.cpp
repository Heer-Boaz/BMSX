/*
 * keyboard.cpp - Keyboard input handler implementation
 */

#include "keyboard.h"
#include "manager.h"
#include "core/console.h"
#include <algorithm>

namespace bmsx {

/* ============================================================================
 * Constructor / Destructor
 * ============================================================================ */

KeyboardInput::KeyboardInput(const std::string& deviceId)
	: m_deviceId(deviceId)
{
	reset();
}

/* ============================================================================
 * InputHandler interface
 * ============================================================================ */

void KeyboardInput::pollInput() {
	m_currentTimeMs = ConsoleCore::instance().clock()->now();
	
	// Update gamepad button states from key states
	for (auto& [keyCode, keyState] : m_keyStates) {
		auto& prev = m_gamepadButtonStates[keyCode];
		const bool isDown = keyState.pressed;
		const bool wasDown = prev.pressed;
		const bool justPressed = m_pendingPresses.contains(keyCode);
		const bool justReleased = m_pendingReleases.contains(keyCode);
		
		i32 pressId = buttonPressIdOr(keyState, buttonPressIdOr(prev, 0));
		if ((isDown || justPressed || justReleased) && !pressId) {
			pressId = m_nextPressId++;
			keyState.pressId = pressId;
		}
		
		const std::optional<f64> pressedAt = isDown
			? std::optional<f64>(keyState.pressedAtMs.has_value() ? keyState.pressedAtMs.value() : buttonPressedAtOr(prev, m_currentTimeMs))
			: std::nullopt;
		
		ButtonState state;
		if (isDown) {
			state.pressed = true;
			state.justpressed = justPressed;
			state.justreleased = false;
			state.waspressed = true;
			state.wasreleased = prev.wasreleased;
			state.presstime = std::max(0.0, m_currentTimeMs - pressedAt.value());
			state.pressedAtMs = pressedAt;
			state.releasedAtMs = std::nullopt;
			state.timestamp = justPressed
				? buttonTimestampOr(keyState, m_currentTimeMs)
				: buttonTimestampOr(prev, pressedAt.value());
			state.pressId = pressId;
			state.value = 1.0f;
			state.consumed = prev.consumed;
		} else {
			state.pressed = false;
			state.justpressed = justPressed;
			state.justreleased = justReleased;
			state.waspressed = prev.waspressed || wasDown || justPressed;
			state.wasreleased = prev.wasreleased || wasDown || justReleased;
			state.presstime = std::nullopt;
			state.pressedAtMs = std::nullopt;
			state.releasedAtMs = justReleased
				? std::optional<f64>(buttonReleasedAtOr(keyState, m_currentTimeMs))
				: prev.releasedAtMs;
			state.timestamp = (justReleased || justPressed)
				? buttonTimestampOr(keyState, m_currentTimeMs)
				: buttonTimestampOr(prev, m_currentTimeMs);
			state.pressId = (justPressed || justReleased || wasDown)
				? std::optional<i32>(pressId)
				: std::nullopt;
			state.value = 0.0f;
			state.consumed = false;
		}
		
		m_gamepadButtonStates[keyCode] = state;
		
		// Map to gamepad button if applicable
		auto it = Input::KEYBOARD_TO_GAMEPAD.find(keyCode);
		if (it != Input::KEYBOARD_TO_GAMEPAD.end()) {
			const std::string& mappedButton = it->second;
			auto& dst = m_gamepadButtonStates[mappedButton];
			
			// Only update if not already pressed by another key
			if (!dst.pressed || state.pressed) {
				dst.pressed = state.pressed;
				dst.justpressed = state.justpressed;
				dst.justreleased = state.justreleased;
				dst.waspressed = state.waspressed;
				dst.wasreleased = state.wasreleased;
				dst.consumed = state.consumed;
				dst.presstime = state.presstime;
				dst.timestamp = state.timestamp;
				dst.pressedAtMs = state.pressedAtMs;
				dst.releasedAtMs = state.releasedAtMs;
				dst.pressId = state.pressId;
				dst.value = state.value;
				dst.value2d = state.value2d;
			}
		}

		m_pendingPresses.erase(keyCode);
		m_pendingReleases.erase(keyCode);
	}
}

ButtonState KeyboardInput::getButtonState(const ButtonId& button) {
	auto it = m_gamepadButtonStates.find(button);
	if (it == m_gamepadButtonStates.end()) {
		return ButtonState{};
	}
	return it->second;
}

void KeyboardInput::consumeButton(const ButtonId& button) {
	// Consume the button state
	auto it = m_gamepadButtonStates.find(button);
	if (it != m_gamepadButtonStates.end()) {
		it->second.consumed = true;
	}
	
	// Also consume any keyboard key that maps to this gamepad button
	for (const auto& [keyCode, mappedButton] : Input::KEYBOARD_TO_GAMEPAD) {
		if (mappedButton == button) {
			auto keyIt = m_gamepadButtonStates.find(keyCode);
			if (keyIt != m_gamepadButtonStates.end()) {
				keyIt->second.consumed = true;
			}
		}
	}
}

void KeyboardInput::reset(const std::vector<std::string>* except) {
	if (!except) {
		m_keyStates.clear();
		m_gamepadButtonStates.clear();
		m_pendingPresses.clear();
		m_pendingReleases.clear();
	} else {
		resetObject(m_keyStates, except);
		resetObject(m_gamepadButtonStates, except);
		for (auto it = m_pendingPresses.begin(); it != m_pendingPresses.end();) {
			if (std::find(except->begin(), except->end(), *it) == except->end()) {
				it = m_pendingPresses.erase(it);
			} else {
				++it;
			}
		}
		for (auto it = m_pendingReleases.begin(); it != m_pendingReleases.end();) {
			if (std::find(except->begin(), except->end(), *it) == except->end()) {
				it = m_pendingReleases.erase(it);
			} else {
				++it;
			}
		}
	}
}

/* ============================================================================
 * Key events
 * ============================================================================ */

void KeyboardInput::keydown(const std::string& keyCode, i32 pressId, f64 timestamp) {
	auto& state = m_keyStates[keyCode];
	if (!state.pressed) {
		state.pressed = true;
		state.timestamp = timestamp;
		state.pressedAtMs = timestamp;
		state.releasedAtMs = std::nullopt;
		state.pressId = pressId != 0 ? std::optional<i32>(pressId) : std::optional<i32>(m_nextPressId++);
		m_pendingPresses.insert(keyCode);
	}
}

void KeyboardInput::keyup(const std::string& keyCode, i32 pressId, f64 timestamp) {
	auto it = m_keyStates.find(keyCode);
	if (it == m_keyStates.end()) {
		return;
	}
	ButtonState& state = it->second;
	if (!state.pressed && !m_pendingPresses.contains(keyCode)) {
		return;
	}
	state.pressed = false;
	state.timestamp = timestamp;
	state.releasedAtMs = timestamp;
	if (pressId != 0) {
		state.pressId = pressId;
	}
	m_pendingReleases.insert(keyCode);
}

} // namespace bmsx
