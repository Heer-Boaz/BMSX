/*
 * pointerinput.cpp - Pointer input handler implementation
 *
 * Mirrors TypeScript input/pointerinput.ts
 */

#include "pointerinput.h"
#include "input.h"
#include "../core/engine_core.h"
#include <algorithm>
#include <cmath>

namespace bmsx {
namespace {

constexpr const char* kPointerPosition = "pointer_position";
constexpr const char* kPointerDelta = "pointer_delta";
constexpr const char* kPointerWheel = "pointer_wheel";

constexpr const char* kPointerDefaultCodes[] = {
	"pointer_primary",
	"pointer_secondary",
	"pointer_aux",
	"pointer_back",
	"pointer_forward",
	kPointerPosition,
	kPointerDelta,
	kPointerWheel,
};

}

PointerInput::PointerInput(const std::string& deviceId)
	: m_deviceId(deviceId) {
	reset();
}

PointerInput::~PointerInput() {
	dispose();
}

void PointerInput::pollInput() {
	const f64 now = EngineCore::instance().clock()->now();
	const f64 prevPollTime = m_lastPollTimeMs;
	m_lastPollTimeMs = now;

	for (auto& [key, state] : m_buttonStates) {
		if (state.pressed) {
			const f64 pressedAt = state.pressedAtMs.value_or(state.timestamp.value_or(now));
			state.presstime = std::max(0.0, now - pressedAt);
			if (prevPollTime > 0.0 && state.justpressed && state.timestamp.value_or(0.0) <= prevPollTime) {
				state.justpressed = false;
			}
		} else {
			state.presstime = std::nullopt;
			if (prevPollTime > 0.0 && state.justreleased && state.timestamp.value_or(0.0) <= prevPollTime) {
				state.justreleased = false;
			}
		}

		if (key == kPointerDelta) {
			const f64 timestamp = state.timestamp.value_or(0.0);
			if (timestamp == m_lastDeltaTimestamp) {
				state.value2d = Vec2(0.0f, 0.0f);
				state.value = 0.0f;
				state.pressed = false;
				state.justpressed = false;
				state.justreleased = false;
			} else {
				m_lastDeltaTimestamp = timestamp;
			}
		} else if (key == kPointerWheel) {
			const f64 timestamp = state.timestamp.value_or(0.0);
			if (timestamp == m_lastWheelTimestamp) {
				const bool wasPressed = state.pressed;
				state.value = 0.0f;
				state.pressed = false;
				state.justpressed = false;
				state.justreleased = wasPressed;
			} else {
				m_lastWheelTimestamp = timestamp;
				state.justreleased = false;
			}
		}

		state.waspressed = state.waspressed || state.pressed;
		state.wasreleased = state.wasreleased || !state.pressed;
		if (state.consumed != true) {
			state.consumed = false;
		}
	}
}

ButtonState PointerInput::getButtonState(const ButtonId& button) {
	auto it = m_buttonStates.find(button);
	if (it == m_buttonStates.end()) {
		return ButtonState{};
	}
	return it->second;
}

void PointerInput::consumeButton(const ButtonId& button) {
	auto it = m_buttonStates.find(button);
	if (it == m_buttonStates.end()) {
		return;
	}
	it->second.consumed = true;
	if (button == kPointerWheel) {
		it->second.pressed = false;
		it->second.justpressed = false;
		it->second.justreleased = false;
	}
}

void PointerInput::reset(const std::vector<std::string>* except) {
	if (!except) {
		m_buttonStates.clear();
		for (const char* code : kPointerDefaultCodes) {
			m_buttonStates[code] = ButtonState{};
		}
		m_nextPressId = 1;
		m_lastPositionX = 0.0f;
		m_lastPositionY = 0.0f;
		m_lastPositionValid = false;
		m_lastPollTimeMs = 0.0;
		m_lastDeltaTimestamp = 0.0;
		m_lastWheelTimestamp = 0.0;
		return;
	}
	resetObjectMap(m_buttonStates, except);
}

void PointerInput::dispose() {
	reset();
}

void PointerInput::ingestButton(const std::string& code, bool down, f32 value,
									f64 timestamp, std::optional<i32> pressId) {
	auto& state = m_buttonStates[code];
	if (down) {
		const i32 resolvedPressId = pressId.value_or(state.pressId.value_or(m_nextPressId++));
		state.pressed = true;
		state.justpressed = true;
		state.justreleased = false;
		state.waspressed = true;
		state.timestamp = timestamp;
		state.pressedAtMs = timestamp;
		state.releasedAtMs = std::nullopt;
		state.value = value;
		state.pressId = resolvedPressId;
		state.consumed = false;
	} else {
		const bool wasPressed = state.pressed;
		state.pressed = false;
		state.justpressed = false;
		state.justreleased = wasPressed;
		state.timestamp = timestamp;
		state.pressedAtMs = std::nullopt;
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

void PointerInput::ingestAxis2(const std::string& code, f32 x, f32 y, f64 timestamp) {
	auto& state = m_buttonStates[code];
	const f32 dx = m_lastPositionValid ? (x - m_lastPositionX) : 0.0f;
	const f32 dy = m_lastPositionValid ? (y - m_lastPositionY) : 0.0f;
	m_lastPositionX = x;
	m_lastPositionY = y;
	m_lastPositionValid = true;

	state.value2d = Vec2(x, y);
	state.timestamp = timestamp;

	auto& delta = m_buttonStates[kPointerDelta];
	const bool moved = dx != 0.0f || dy != 0.0f;
	const bool wasPressed = delta.pressed;
	delta.value2d = Vec2(dx, dy);
	delta.value = std::hypot(dx, dy);
	delta.timestamp = timestamp;
	delta.justreleased = !moved && wasPressed;
	delta.pressed = moved;
	delta.justpressed = moved && !wasPressed;
	delta.waspressed = moved || wasPressed;
	delta.consumed = false;
}

void PointerInput::ingestAxis1(const std::string& code, f32 value, f64 timestamp) {
	auto& state = m_buttonStates[code];
	state.value = value;
	state.timestamp = timestamp;
	if (code != kPointerWheel || value == 0.0f) {
		return;
	}
	state.pressed = true;
	state.justpressed = true;
	state.justreleased = false;
	state.waspressed = true;
	state.consumed = false;
	state.pressedAtMs = timestamp;
	state.releasedAtMs = std::nullopt;
	state.pressId = m_nextPressId++;
}

} // namespace bmsx
