/*
 * inputstatemanager.cpp - Input state manager implementation
 *
 * Mirrors TypeScript InputStateManager class from input/input.ts
 */

#include "inputstatemanager.h"
#include <algorithm>

namespace bmsx {

/* ============================================================================
 * Constructor
 * ============================================================================ */

InputStateManager::InputStateManager() = default;

/* ============================================================================
 * Frame lifecycle
 * ============================================================================ */

void InputStateManager::beginFrame(f64 currentTimeMs) {
	m_currentTimeMs = currentTimeMs;
	
	// Reset edge flags for all buttons
	for (auto& [id, state] : m_buttonStates) {
		state.justpressed = false;
		state.justreleased = false;
		// Keep waspressed/wasreleased - they're for windowed detection
	}
}

void InputStateManager::update(f64 currentTimeMs) {
	m_currentTimeMs = currentTimeMs;
	
	// Update press time for pressed buttons
	for (auto& [id, state] : m_buttonStates) {
		if (state.pressed && state.pressedAtMs.has_value()) {
			state.presstime = currentTimeMs - state.pressedAtMs.value();
		}
	}
	
	// Remove old events from buffer
	pruneOldEvents();
}

/* ============================================================================
 * Event handling
 * ============================================================================ */

void InputStateManager::addInputEvent(InputEvent evt) {
	m_inputBuffer.push_back(std::move(evt));
	
	// Update corresponding button state
	auto& state = m_buttonStates[evt.identifier];
	
	if (evt.eventType == InputEvent::Type::Press) {
		bool wasPressed = state.pressed;
		state.pressed = true;
		state.justpressed = !wasPressed;
		state.justreleased = false;
		state.waspressed = true;
		state.timestamp = evt.timestamp;
		state.pressedAtMs = evt.timestamp;
		state.pressId = evt.pressId;
		state.value = 1.0f;
		state.consumed = false;
	} else {
		bool wasPressed = state.pressed;
		state.pressed = false;
		state.justpressed = false;
		state.justreleased = wasPressed;
		state.wasreleased = state.wasreleased || wasPressed;
		state.timestamp = evt.timestamp;
		state.releasedAtMs = evt.timestamp;
		state.presstime.reset();
		state.value = 0.0f;
		state.consumed = false;
	}
}

void InputStateManager::consumeBufferedEvent(const std::string& identifier, std::optional<i32> pressId) {
	for (auto& evt : m_inputBuffer) {
		if (evt.identifier == identifier) {
			if (!pressId.has_value() || evt.pressId == pressId) {
				evt.consumed = true;
			}
		}
	}
}

/* ============================================================================
 * State queries
 * ============================================================================ */

ButtonState InputStateManager::getButtonState(const std::string& button, std::optional<f64> windowMs) const {
	auto it = m_buttonStates.find(button);
	if (it == m_buttonStates.end()) {
		return ButtonState{};
	}
	
	ButtonState state = it->second;
	
	// If windowed detection requested, check buffer
	if (windowMs.has_value()) {
		state.waspressed = wasPressedInWindow(button, windowMs.value());
		state.wasreleased = wasReleasedInWindow(button, windowMs.value());
	}
	
	return state;
}

bool InputStateManager::wasPressedInWindow(const std::string& button, f64 windowMs) const {
	f64 cutoff = m_currentTimeMs - windowMs;
	
	for (const auto& evt : m_inputBuffer) {
		if (evt.identifier == button && 
			evt.eventType == InputEvent::Type::Press &&
			evt.timestamp >= cutoff &&
			!evt.consumed) {
			return true;
		}
	}
	
	return false;
}

bool InputStateManager::wasReleasedInWindow(const std::string& button, f64 windowMs) const {
	f64 cutoff = m_currentTimeMs - windowMs;
	
	for (const auto& evt : m_inputBuffer) {
		if (evt.identifier == button && 
			evt.eventType == InputEvent::Type::Release &&
			evt.timestamp >= cutoff &&
			!evt.consumed) {
			return true;
		}
	}
	
	return false;
}

std::optional<i32> InputStateManager::getLatestUnconsumedPressId(const std::string& button) const {
	for (auto it = m_inputBuffer.rbegin(); it != m_inputBuffer.rend(); ++it) {
		if (it->identifier != button) {
			continue;
		}
		if (it->eventType != InputEvent::Type::Press) {
			continue;
		}
		if (it->consumed) {
			continue;
		}
		return it->pressId;
	}
	return std::nullopt;
}

std::optional<i32> InputStateManager::getLatestUnconsumedReleaseId(const std::string& button) const {
	for (auto it = m_inputBuffer.rbegin(); it != m_inputBuffer.rend(); ++it) {
		if (it->identifier != button) {
			continue;
		}
		if (it->eventType != InputEvent::Type::Release) {
			continue;
		}
		if (it->consumed) {
			continue;
		}
		return it->pressId;
	}
	return std::nullopt;
}

/* ============================================================================
 * State management
 * ============================================================================ */

void InputStateManager::resetEdgeState() {
	for (auto& [id, state] : m_buttonStates) {
		state.justpressed = false;
		state.justreleased = false;
		state.waspressed = false;
		state.wasreleased = false;
	}
	
	// Clear input buffer
	m_inputBuffer.clear();
}

void InputStateManager::clear() {
	m_buttonStates.clear();
	m_inputBuffer.clear();
	m_currentTimeMs = 0.0;
}

/* ============================================================================
 * Helpers
 * ============================================================================ */

void InputStateManager::pruneOldEvents() {
	f64 cutoff = m_currentTimeMs - BUFFER_RETENTION_MS;
	
	while (!m_inputBuffer.empty() && m_inputBuffer.front().timestamp < cutoff) {
		m_inputBuffer.pop_front();
	}
}

} // namespace bmsx
