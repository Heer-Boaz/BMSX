/*
 * inputstatemanager.cpp - Input state manager implementation
 *
 * Mirrors TypeScript InputStateManager class from input/input.ts
 */

#include "inputstatemanager.h"

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
	m_currentFrame += 1;
	
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
	pruneBufferedEdges(m_bufferedPressEdges);
	pruneBufferedEdges(m_bufferedReleaseEdges);
}

/* ============================================================================
 * Event handling
 * ============================================================================ */

void InputStateManager::addInputEvent(InputEvent evt) {
	const i64 bufferedFrame = m_currentFrame + 1;
	BufferedInputEvent bufferedEvent{
		.event = std::move(evt),
		.frame = bufferedFrame,
	};
	const InputEvent& event = bufferedEvent.event;
	const std::string& id = event.identifier;
	
	// Update corresponding button state
	auto& state = m_buttonStates[id];
	
	if (event.eventType == InputEvent::Type::Press) {
		if (state.pressed) {
			state.timestamp = event.timestamp;
			return;
		}
		state.pressed = true;
		state.justpressed = true;
		state.justreleased = false;
		state.waspressed = true;
		state.timestamp = event.timestamp;
		state.pressedAtMs = event.timestamp;
		state.pressId = event.pressId.has_value() ? event.pressId : state.pressId;
		state.value = 1.0f;
		state.consumed = event.consumed;
		if (event.pressId.has_value()) {
			m_bufferedPressEdges[id] = BufferedEdgeRecord{
				.edgeId = event.pressId.value(),
				.frame = bufferedFrame,
				.consumed = event.consumed,
			};
		}
	} else {
		state.pressed = false;
		state.justpressed = false;
		state.justreleased = true;
		state.wasreleased = true;
		state.timestamp = event.timestamp;
		state.releasedAtMs = event.timestamp;
		state.presstime.reset();
		state.pressId = event.pressId.has_value() ? event.pressId : state.pressId;
		state.value = 0.0f;
		state.consumed = event.consumed;
		if (event.pressId.has_value()) {
			m_bufferedReleaseEdges[id] = BufferedEdgeRecord{
				.edgeId = event.pressId.value(),
				.frame = bufferedFrame,
				.consumed = event.consumed,
			};
		}
	}

	m_inputBuffer.push_back(std::move(bufferedEvent));
}

void InputStateManager::consumeBufferedEvent(const std::string& identifier, std::optional<i32> pressId) {
	for (auto& bufferedEvent : m_inputBuffer) {
		if (bufferedEvent.event.identifier == identifier) {
			if (!pressId.has_value() || bufferedEvent.event.pressId == pressId) {
				bufferedEvent.event.consumed = true;
			}
		}
	}
	const auto consumeBufferedEdge = [&](std::unordered_map<std::string, BufferedEdgeRecord>& edgeMap) {
		auto it = edgeMap.find(identifier);
		if (it == edgeMap.end()) {
			return;
		}
		if (!pressId.has_value() || it->second.edgeId == pressId.value()) {
			it->second.consumed = true;
		}
	};
	consumeBufferedEdge(m_bufferedPressEdges);
	consumeBufferedEdge(m_bufferedReleaseEdges);
	auto stateIt = m_buttonStates.find(identifier);
	if (stateIt != m_buttonStates.end()) {
		stateIt->second.consumed = true;
	}
}

/* ============================================================================
 * State queries
 * ============================================================================ */

ButtonState InputStateManager::getButtonState(const std::string& button, std::optional<i32> windowFrames) const {
	auto it = m_buttonStates.find(button);
	if (it == m_buttonStates.end()) {
		return ButtonState{};
	}
	
	ButtonState state = it->second;
	
	const i32 effectiveWindow = windowFrames.value_or(BUFFER_FRAME_RETENTION);
	state.justpressed = getBufferedEdgeRecord(m_bufferedPressEdges, button, 1).has_value();
	state.justreleased = getBufferedEdgeRecord(m_bufferedReleaseEdges, button, 1).has_value();
	state.waspressed = state.pressed || wasPressedInWindow(button, effectiveWindow);
	state.wasreleased = state.justreleased || wasReleasedInWindow(button, effectiveWindow);
	if (!state.consumed) {
		for (const auto& bufferedEvent : m_inputBuffer) {
			if (bufferedEvent.event.identifier == button &&
				bufferedEvent.frame <= m_currentFrame &&
				isBufferedFrameInWindow(bufferedEvent.frame, effectiveWindow) &&
				bufferedEvent.event.consumed) {
				state.consumed = true;
				break;
			}
		}
	}
	
	return state;
}

bool InputStateManager::wasPressedInWindow(const std::string& button, i32 windowFrames) const {
	for (const auto& bufferedEvent : m_inputBuffer) {
		if (bufferedEvent.event.identifier == button &&
			bufferedEvent.event.eventType == InputEvent::Type::Press &&
			bufferedEvent.frame <= m_currentFrame &&
			isBufferedFrameInWindow(bufferedEvent.frame, windowFrames)) {
			return true;
		}
	}
	
	return false;
}

bool InputStateManager::wasReleasedInWindow(const std::string& button, i32 windowFrames) const {
	for (const auto& bufferedEvent : m_inputBuffer) {
		if (bufferedEvent.event.identifier == button &&
			bufferedEvent.event.eventType == InputEvent::Type::Release &&
			bufferedEvent.frame <= m_currentFrame &&
			isBufferedFrameInWindow(bufferedEvent.frame, windowFrames)) {
			return true;
		}
	}
	
	return false;
}

std::optional<i32> InputStateManager::getLatestUnconsumedPressId(const std::string& button) const {
	return getLatestUnconsumedEdgeId(button, InputEvent::Type::Press);
}

std::optional<i32> InputStateManager::getLatestUnconsumedReleaseId(const std::string& button) const {
	return getLatestUnconsumedEdgeId(button, InputEvent::Type::Release);
}

bool InputStateManager::hasTrackedButton(const std::string& button) const {
	return m_buttonStates.find(button) != m_buttonStates.end();
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
	m_bufferedPressEdges.clear();
	m_bufferedReleaseEdges.clear();
	m_currentFrame = 0;
}

void InputStateManager::clear() {
	m_buttonStates.clear();
	m_inputBuffer.clear();
	m_bufferedPressEdges.clear();
	m_bufferedReleaseEdges.clear();
	m_currentFrame = 0;
	m_currentTimeMs = 0.0;
}

/* ============================================================================
 * Helpers
 * ============================================================================ */

std::optional<i32> InputStateManager::getLatestUnconsumedEdgeId(const std::string& button, InputEvent::Type eventType) const {
	const auto& edgeMap = eventType == InputEvent::Type::Press
		? m_bufferedPressEdges
		: m_bufferedReleaseEdges;
	auto edge = getBufferedEdgeRecord(edgeMap, button, RECENT_BUFFERED_EDGE_FRAMES);
	if (!edge.has_value()) {
		return std::nullopt;
	}
	return edge->edgeId;
}

std::optional<InputStateManager::BufferedEdgeRecord> InputStateManager::getBufferedEdgeRecord(
	const std::unordered_map<std::string, BufferedEdgeRecord>& edgeMap,
	const std::string& button,
	i32 windowFrames
) const {
	auto it = edgeMap.find(button);
	if (it == edgeMap.end()) {
		return std::nullopt;
	}
	const BufferedEdgeRecord& edge = it->second;
	if (edge.consumed || edge.frame > m_currentFrame || !isBufferedFrameInWindow(edge.frame, windowFrames)) {
		return std::nullopt;
	}
	return edge;
}

bool InputStateManager::isBufferedFrameInWindow(i64 frame, i32 windowFrames) const {
	if (windowFrames <= 0) {
		return false;
	}
	return m_currentFrame - frame < windowFrames;
}

void InputStateManager::pruneOldEvents() {
	while (!m_inputBuffer.empty() && !isBufferedFrameInWindow(m_inputBuffer.front().frame, BUFFER_FRAME_RETENTION)) {
		m_inputBuffer.pop_front();
	}
}

void InputStateManager::pruneBufferedEdges(std::unordered_map<std::string, BufferedEdgeRecord>& edgeMap) {
	for (auto it = edgeMap.begin(); it != edgeMap.end();) {
		if (!isBufferedFrameInWindow(it->second.frame, BUFFER_FRAME_RETENTION)) {
			it = edgeMap.erase(it);
			continue;
		}
		++it;
	}
}

} // namespace bmsx
