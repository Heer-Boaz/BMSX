/*
 * keyboardinput.cpp - Keyboard input handler implementation
 *
 * Mirrors TypeScript input/keyboardinput.ts
 */

#include "keyboardinput.h"
#include "input.h"
#include "../core/engine_core.h"
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

KeyboardInput::~KeyboardInput() {
	dispose();
}

/* ============================================================================
 * InputHandler interface
 * ============================================================================ */

void KeyboardInput::pollInput() {
	m_currentTimeMs = EngineCore::instance().clock()->now();
	
	// Update gamepad button states from key states
	for (auto& [keyCode, keyState] : m_keyStates) {
		auto& prev = m_gamepadButtonStates[keyCode];
		bool isDown = keyState.pressed;
		bool wasDown = prev.pressed;
		
		i32 pressId = keyState.pressId.value_or(prev.pressId.value_or(0));
		if (isDown && !pressId) {
			pressId = m_nextPressId++;
		}
		
		f64 pressedAt = wasDown 
			? prev.pressedAtMs.value_or(prev.timestamp.value_or(m_currentTimeMs))
			: m_currentTimeMs;
		
		ButtonState state;
		if (isDown) {
			bool stickyConsumed = prev.consumed;
			state.pressed = true;
			state.justpressed = !wasDown;
			state.justreleased = false;
			state.waspressed = true;
			state.wasreleased = prev.wasreleased;
			state.presstime = std::max(0.0, m_currentTimeMs - pressedAt);
			state.pressedAtMs = pressedAt;
			state.releasedAtMs = std::nullopt;
			state.timestamp = wasDown ? prev.timestamp.value_or(pressedAt) : m_currentTimeMs;
			state.pressId = pressId;
			state.value = 1.0f;
			state.consumed = stickyConsumed;
		} else {
			state.pressed = false;
			state.justpressed = false;
			state.justreleased = wasDown;
			state.waspressed = prev.waspressed || wasDown;
			state.wasreleased = prev.wasreleased || wasDown;
			state.presstime = std::nullopt;
			state.pressedAtMs = std::nullopt;
			state.releasedAtMs = wasDown ? m_currentTimeMs : prev.releasedAtMs;
			state.timestamp = wasDown ? m_currentTimeMs : prev.timestamp.value_or(m_currentTimeMs);
			state.pressId = wasDown ? prev.pressId : std::nullopt;
			state.value = 0.0f;
			state.consumed = false;
		}
		
		m_gamepadButtonStates[keyCode] = state;
		
		// Map to gamepad button if applicable
		const auto& mapping = Input::KEYBOARD_TO_GAMEPAD();
		auto it = mapping.find(keyCode);
		if (it != mapping.end()) {
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
	const auto& mapping = Input::KEYBOARD_TO_GAMEPAD();
	for (const auto& [keyCode, mappedButton] : mapping) {
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
	} else {
		resetObjectMap(m_keyStates, except);
		resetObjectMap(m_gamepadButtonStates, except);
	}
}

void KeyboardInput::dispose() {
	reset();
}

/* ============================================================================
 * Key events
 * ============================================================================ */

void KeyboardInput::keydown(const std::string& keyCode, i32 pressId, f64 timestamp) {
	auto& state = m_keyStates[keyCode];
	state.pressed = true;
	state.justpressed = true;
	state.presstime = 0.0;
	state.timestamp = timestamp;
	state.pressedAtMs = timestamp;
	state.pressId = pressId;
}

void KeyboardInput::keyup(const std::string& keyCode, i32 /*pressId*/, f64 /*timestamp*/) {
	m_keyStates[keyCode] = ButtonState{};
}

void KeyboardInput::blur() {
	reset();
}

void KeyboardInput::focus() {
	reset();
}

} // namespace bmsx
