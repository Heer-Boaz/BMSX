/*
 * inputstatemanager.cpp - Input state manager implementation
 *
 * Mirrors TypeScript InputStateManager class from input/input.ts
 */

#include "inputstatemanager.h"
#include "../core/engine_core.h"
#include <algorithm>

namespace bmsx {

/* ============================================================================
 * Constructor
 * ============================================================================ */

InputStateManager::InputStateManager() = default;

/* ============================================================================
 * Frame lifecycle
 * ============================================================================ */

/* ============================================================================
 * Frame lifecycle
 * ============================================================================ */

void InputStateManager::beginFrame(f64 currentTimeMs) {
	m_currentTimeMs = currentTimeMs;
	
	// Reset edge flags for all buttons (parity with TS)
	for (auto& [id, state] : m_buttonStates) {
		state.justpressed = false;
		state.justreleased = false;
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
	const std::string id = evt.identifier;
	
	// Update corresponding button state
	auto& state = m_buttonStates[id];
	
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
		if (!evt.consumed && evt.pressId.has_value()) {
			m_latestUnconsumedPressIdByButton[id] = evt.pressId.value();
		}
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
		if (!evt.consumed && evt.pressId.has_value()) {
			m_latestUnconsumedReleaseIdByButton[id] = evt.pressId.value();
		}
	}

	m_inputBuffer.push_back(std::move(evt));
}

void InputStateManager::consumeBufferedEvent(const std::string& identifier, std::optional<i32> pressId) {
	for (auto& evt : m_inputBuffer) {
		if (evt.identifier == identifier) {
			if (!pressId.has_value() || evt.pressId == pressId) {
				evt.consumed = true;
			}
		}
	}
	if (!pressId.has_value()) {
		m_latestUnconsumedPressIdByButton.erase(identifier);
		m_latestUnconsumedReleaseIdByButton.erase(identifier);
	} else {
		auto pressIt = m_latestUnconsumedPressIdByButton.find(identifier);
		if (pressIt != m_latestUnconsumedPressIdByButton.end() && pressIt->second == pressId.value()) {
			m_latestUnconsumedPressIdByButton.erase(pressIt);
		}
		auto releaseIt = m_latestUnconsumedReleaseIdByButton.find(identifier);
		if (releaseIt != m_latestUnconsumedReleaseIdByButton.end() && releaseIt->second == pressId.value()) {
			m_latestUnconsumedReleaseIdByButton.erase(releaseIt);
		}
	}
	m_buttonStates[identifier].consumed = true;
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
	
	// Parity with TS: Always compute windowed waspressed/wasreleased, using default if not specified
	// TS uses: bufferframeDuration * $.timestep_ms = 150 * (1000/60) = 2500ms
	f64 effectiveWindow = windowMs.value_or(BUFFER_FRAME_RETENTION * (1000.0 / 60.0));
	state.waspressed = state.pressed || wasPressedInWindow(button, effectiveWindow);
	state.wasreleased = state.justreleased || wasReleasedInWindow(button, effectiveWindow);
	if (!state.consumed) {
		f64 cutoff = m_currentTimeMs - effectiveWindow;
		for (const auto& evt : m_inputBuffer) {
			if (evt.identifier == button && evt.timestamp >= cutoff && evt.consumed) {
				state.consumed = true;
				break;
			}
		}
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
	auto it = m_latestUnconsumedPressIdByButton.find(button);
	if (it != m_latestUnconsumedPressIdByButton.end()) {
		return it->second;
	}
	return std::nullopt;
}

std::optional<i32> InputStateManager::getLatestUnconsumedReleaseId(const std::string& button) const {
	auto it = m_latestUnconsumedReleaseIdByButton.find(button);
	if (it != m_latestUnconsumedReleaseIdByButton.end()) {
		return it->second;
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
	m_latestUnconsumedPressIdByButton.clear();
	m_latestUnconsumedReleaseIdByButton.clear();
}

void InputStateManager::clear() {
	m_buttonStates.clear();
	m_inputBuffer.clear();
	m_latestUnconsumedPressIdByButton.clear();
	m_latestUnconsumedReleaseIdByButton.clear();
	m_currentTimeMs = 0.0;
}

/* ============================================================================
 * Helpers
 * ============================================================================ */

void InputStateManager::pruneOldEvents() {
	// Parity with TS: Use fixed timestep for window calculation (150 * 16.666ms)
	f64 cutoff = m_currentTimeMs - (BUFFER_FRAME_RETENTION * (1000.0 / 50.0));
	
	while (!m_inputBuffer.empty() && m_inputBuffer.front().timestamp < cutoff) {
		m_inputBuffer.pop_front();
	}
}

} // namespace bmsx
