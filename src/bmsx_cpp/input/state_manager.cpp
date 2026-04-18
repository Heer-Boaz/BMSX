/*
 * state_manager.cpp - Input state manager implementation
 */

#include "state_manager.h"
#include <cmath>

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
	
	for (auto& [id, state] : m_buttonStates) {
		(void)id;
		state.justpressed = false;
		state.justreleased = false;
		if (state.pressed) {
			const f64 pressedAt = state.pressedAtMs.value_or(state.timestamp.value_or(currentTimeMs));
			state.presstime = std::max(0.0, currentTimeMs - pressedAt);
		} else {
			state.presstime = std::nullopt;
		}
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
	if (event.eventType == InputEvent::Type::Press) {
		if (event.pressId.has_value()) {
			m_bufferedPressEdges[id] = BufferedEdgeRecord{
				.edgeId = event.pressId.value(),
				.frame = bufferedFrame,
				.consumed = event.consumed,
			};
		}
	} else {
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

void InputStateManager::recordAxis1Sample(const std::string& button, f32 value, f64 timestamp) {
	auto& state = m_pendingFrameStates[button];
	if (button == "pointer_wheel") {
		const f32 accumulated = state.value + value;
		state.value = accumulated;
		state.pressed = accumulated != 0.0f;
		state.justpressed = accumulated != 0.0f;
		state.timestamp = timestamp;
		if (!state.pressedAtMs.has_value()) {
			state.pressedAtMs = timestamp;
		}
		state.consumed = false;
		return;
	}
	const f32 magnitude = std::abs(value);
	state.value = value;
	state.pressed = magnitude > 0.0f;
	state.justpressed = state.justpressed || state.pressed;
	state.timestamp = timestamp;
	if (state.pressed && !state.pressedAtMs.has_value()) {
		state.pressedAtMs = timestamp;
	}
	state.consumed = false;
}

void InputStateManager::recordAxis2Sample(const std::string& button, f32 x, f32 y, f64 timestamp) {
	auto& state = m_pendingFrameStates[button];
	if (button == "pointer_delta") {
		const Vec2 previous = state.value2d.value_or(Vec2(0.0f, 0.0f));
		const f32 nextX = previous.x + x;
		const f32 nextY = previous.y + y;
		state.value2d = Vec2(nextX, nextY);
		state.value = std::hypot(nextX, nextY);
		state.pressed = state.value > 0.0f;
		state.justpressed = state.justpressed || state.pressed;
		state.timestamp = timestamp;
		if (!state.pressedAtMs.has_value()) {
			state.pressedAtMs = timestamp;
		}
		state.consumed = false;
		return;
	}
	state.value2d = Vec2(x, y);
	state.value = std::hypot(x, y);
	state.timestamp = timestamp;
	if (button == "pointer_position") {
		state.consumed = false;
		return;
	}
	state.pressed = state.value > 0.0f;
	state.justpressed = state.justpressed || state.pressed;
	if (state.pressed && !state.pressedAtMs.has_value()) {
		state.pressedAtMs = timestamp;
	}
	state.consumed = false;
}

void InputStateManager::latchButtonState(const std::string& button, const ButtonState& rawState, f64 currentTimeMs) {
	auto& state = m_buttonStates[button];
	auto pendingIt = m_pendingFrameStates.find(button);
	ButtonState* pending = pendingIt != m_pendingFrameStates.end() ? &pendingIt->second : nullptr;
	const auto bufferedPress = getBufferedEdgeRecord(m_bufferedPressEdges, button, 1);
	const auto bufferedRelease = getBufferedEdgeRecord(m_bufferedReleaseEdges, button, 1);
	const bool previousPressed = state.pressed;
	const bool nextPressed = pending && pending->pressed ? true : rawState.pressed;
	const f64 nextTimestamp = pending && pending->timestamp.has_value()
		? pending->timestamp.value()
		: rawState.timestamp.value_or(state.timestamp.value_or(currentTimeMs));
	const std::optional<i32> nextPressId = rawState.pressId.has_value()
		? rawState.pressId
		: (state.pressId.has_value() ? state.pressId : (pending && pending->pressId.has_value() ? pending->pressId : std::nullopt));
	const std::optional<f64> nextPressedAtMs = nextPressed
		? std::optional<f64>(rawState.pressedAtMs.value_or(pending && pending->pressedAtMs.has_value()
			? pending->pressedAtMs.value()
			: state.pressedAtMs.value_or(nextTimestamp)))
		: std::nullopt;
	const std::optional<f64> nextReleasedAtMs = nextPressed
		? std::nullopt
		: (rawState.releasedAtMs.has_value()
			? rawState.releasedAtMs
			: (state.releasedAtMs.has_value() ? state.releasedAtMs : (bufferedRelease.has_value() ? std::optional<f64>(nextTimestamp) : std::nullopt)));
	state.pressed = nextPressed;
	state.justpressed = bufferedPress.has_value() || (pending && pending->justpressed && !previousPressed);
	state.justreleased = bufferedRelease.has_value() || (pending && pending->justreleased && previousPressed);
	state.consumed = nextPressed ? state.consumed : false;
	state.timestamp = nextTimestamp;
	state.pressedAtMs = nextPressedAtMs;
	state.releasedAtMs = nextReleasedAtMs;
	state.pressId = nextPressId;
	state.value = pending ? pending->value : rawState.value;
	if (!pending) {
		state.value2d = rawState.value2d;
	} else {
		state.value2d = pending->value2d.has_value() ? pending->value2d : rawState.value2d;
	}
	state.presstime = nextPressed
		? std::optional<f64>(std::max(0.0, currentTimeMs - nextPressedAtMs.value_or(nextTimestamp)))
		: std::nullopt;
	if (pendingIt != m_pendingFrameStates.end()) {
		m_pendingFrameStates.erase(pendingIt);
	}
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
	ButtonState state;
	auto it = m_buttonStates.find(button);
	if (it != m_buttonStates.end()) {
		state = it->second;
	}
	
	const i32 effectiveWindow = windowFrames.value_or(BUFFER_FRAME_RETENTION);
	state.justpressed = state.justpressed || getBufferedEdgeRecord(m_bufferedPressEdges, button, 1).has_value();
	state.justreleased = state.justreleased || getBufferedEdgeRecord(m_bufferedReleaseEdges, button, 1).has_value();
	state.waspressed = state.pressed || wasPressedInWindow(button, effectiveWindow);
	state.wasreleased = state.justreleased || wasReleasedInWindow(button, effectiveWindow);
	for (const auto& bufferedEvent : m_inputBuffer) {
		if (bufferedEvent.event.identifier == button &&
			bufferedEvent.frame <= m_currentFrame &&
			isBufferedFrameInWindow(bufferedEvent.frame, effectiveWindow) &&
			bufferedEvent.event.consumed &&
			(!state.pressId.has_value() || (bufferedEvent.event.pressId.has_value() && bufferedEvent.event.pressId.value() == state.pressId.value()))) {
			state.consumed = true;
			break;
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
	m_pendingFrameStates.clear();
	m_currentFrame = 0;
}

void InputStateManager::clear() {
	m_buttonStates.clear();
	m_pendingFrameStates.clear();
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
