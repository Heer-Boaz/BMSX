/*
 * player.cpp - Per-player input handling implementation
 */

#include "player.h"

namespace bmsx {

/* ============================================================================
 * Constructor / Destructor
 * ============================================================================ */

PlayerInput::PlayerInput(i32 playerIndex)
	: playerIndex(playerIndex)
{
	reset();
}

PlayerInput::~PlayerInput() = default;

/* ============================================================================
 * Input handlers
 * ============================================================================ */

void PlayerInput::assignGamepadToPlayer(InputHandler* gamepad) {
	auto* existing = inputHandlers[sourceIndex(InputSource::Gamepad)];
	if (existing && existing != gamepad) {
		existing->reset();
	}
	inputHandlers[sourceIndex(InputSource::Gamepad)] = gamepad;
}

void PlayerInput::clearGamepad(InputHandler* handler) {
	if (inputHandlers[sourceIndex(InputSource::Gamepad)] != handler) return;
	inputHandlers[sourceIndex(InputSource::Gamepad)] = nullptr;
	handler->reset();
}

void PlayerInput::applyInputControllerVibrationEffect(f64 durationMs, f32 intensity) {
	VibrationParams params;
	params.duration = durationMs;
	params.intensity = intensity;
	for (InputHandler* handler : inputHandlers) {
		if (handler && handler->supportsVibrationEffect()) {
			handler->applyVibrationEffect(params);
		}
	}
}

/* ============================================================================
 * Button state
 * ============================================================================ */

ButtonState PlayerInput::getButtonState(const std::string& button, InputSource source, std::optional<i32> windowFrames) {
	return getStateManager(source).getButtonState(button, windowFrames);
}

ButtonState PlayerInput::getRawButtonState(const std::string& button, InputSource source) {
	auto* handler = inputHandlers[sourceIndex(source)];
	return handler ? handler->getButtonState(button) : ButtonState{};
}

ActionState PlayerInput::getButtonRepeatState(const std::string& button, InputSource source) {
	ButtonState state = getRawButtonState(button, source);
	std::string repeatKey = std::to_string(static_cast<int>(source)) + ":" + button;
	ActionState actionState(repeatKey, state);
	auto repeat = evaluateRawActionRepeat(repeatKey, state, m_frameCounter);
	actionState.repeatcount = repeat.count;
	actionState.repeatpressed = repeat.triggered;
	return actionState;
}

/* ============================================================================
 * Modifiers
 * ============================================================================ */

PlayerInput::ModifierState PlayerInput::getModifiersState() {
	auto* keyboard = inputHandlers[sourceIndex(InputSource::Keyboard)];
	if (!keyboard) return {};

	ModifierState state;
	state.ctrl = keyboard->getButtonState("ControlLeft").pressed ||
					keyboard->getButtonState("ControlRight").pressed;
	state.alt = keyboard->getButtonState("AltLeft").pressed ||
				keyboard->getButtonState("AltRight").pressed;
	state.shift = keyboard->getButtonState("ShiftLeft").pressed ||
					keyboard->getButtonState("ShiftRight").pressed;
	state.meta = keyboard->getButtonState("MetaLeft").pressed ||
					keyboard->getButtonState("MetaRight").pressed;
	return state;
}

/* ============================================================================
 * Consume
 * ============================================================================ */

void PlayerInput::consumeRawButton(const std::string& button, InputSource source) {
	consumeGameplayButton(button, source);
	auto* handler = inputHandlers[sourceIndex(source)];
	if (handler) {
		handler->consumeButton(button);
	}
}

void PlayerInput::consumeGameplayButton(const std::string& button, InputSource source) {
	auto state = getButtonState(button, source);
	getStateManager(source).consumeBufferedEvent(button, state.pressId);
}

/* ============================================================================
 * Frame lifecycle
 * ============================================================================ */

void PlayerInput::pollInput(f64 currentTimeMs) {
	m_frameCounter++;
	m_lastPollTimestampMs = currentTimeMs;
	for (size_t i = 0; i < INPUT_SOURCE_COUNT; i++) {
		if (inputHandlers[i]) {
			inputHandlers[i]->pollInput();
		}
	}
}

void PlayerInput::recordButtonEvent(InputSource source, const std::string& button, InputEvent evt) {
	m_trackedButtons[sourceIndex(source)].insert(button);
	getStateManager(source).addInputEvent(std::move(evt));
}

void PlayerInput::recordAxis1Input(InputSource source, const std::string& button, f32 value, f64 timestamp) {
	m_trackedButtons[sourceIndex(source)].insert(button);
	getStateManager(source).recordAxis1Sample(button, value, timestamp);
}

void PlayerInput::recordAxis2Input(InputSource source, const std::string& button, f32 x, f32 y, f64 timestamp) {
	m_trackedButtons[sourceIndex(source)].insert(button);
	getStateManager(source).recordAxis2Sample(button, x, y, timestamp);
}

void PlayerInput::beginFrame(f64 currentTimeMs) {
	for (size_t i = 0; i < INPUT_SOURCE_COUNT; i++) {
		const InputSource source = INPUT_SOURCES[i];
		auto& manager = getStateManager(source);
		manager.beginFrame(currentTimeMs);
		auto* handler = inputHandlers[i];
		for (const auto& button : m_trackedButtons[i]) {
			manager.latchButtonState(button, handler ? handler->getButtonState(button) : ButtonState{}, currentTimeMs);
		}
	}
}

void PlayerInput::update(f64 currentTimeMs) {
	for (size_t i = 0; i < INPUT_SOURCE_COUNT; i++) {
		getStateManager(INPUT_SOURCES[i]).update(currentTimeMs);
	}
}

/* ============================================================================
 * Reset
 * ============================================================================ */

void PlayerInput::reset(const std::vector<std::string>* except) {
	clearEdgeState();
	for (size_t i = 0; i < INPUT_SOURCE_COUNT; i++) {
		if (inputHandlers[i]) {
			inputHandlers[i]->reset(except);
		}
	}
	m_rawActionRepeatRecords.clear();
	m_lastPollTimestampMs.reset();
	m_frameCounter = 0;
}

void PlayerInput::clearEdgeState() {
	for (size_t i = 0; i < INPUT_SOURCE_COUNT; i++) {
		getStateManager(INPUT_SOURCES[i]).resetEdgeState();
	}
}

/* ============================================================================
 * Repeat helper
 * ============================================================================ */

PlayerInput::RepeatResult PlayerInput::evaluateRawActionRepeat(const std::string& action,
																const ButtonState& state,
																i64 frameId) {
	auto& repeat = ensureRawRepeatState(action);
	if (repeat.lastFrameEvaluated == frameId) {
		return { repeat.lastResult, repeat.repeatCount };
	}

	bool result = false;
	const f64 now = m_lastPollTimestampMs.value();
	const f64 startMs = buttonPressedAtOr(state, now);
	const f64 initialDelayMs = INITIAL_REPEAT_DELAY_FRAMES * m_frameDurationMs;
	const f64 repeatIntervalMs = REPEAT_INTERVAL_FRAMES * m_frameDurationMs;

	if (state.justpressed) {
		repeat.active = true;
		repeat.repeatCount = 0;
		repeat.pressStartMs = startMs;
		repeat.lastRepeatAtMs = startMs;
	} else if (!state.pressed) {
		repeat.active = false;
		repeat.repeatCount = 0;
		repeat.pressStartMs = -1.0;
		repeat.lastRepeatAtMs = -1.0;
	} else {
		if (!repeat.active) {
			repeat.active = true;
			repeat.repeatCount = 0;
			repeat.pressStartMs = startMs;
			repeat.lastRepeatAtMs = startMs;
		}
		if (repeat.pressStartMs < 0.0) {
			repeat.pressStartMs = startMs;
		}

		const f64 nextAt = (repeat.repeatCount == 0)
			? repeat.pressStartMs + initialDelayMs
			: repeat.lastRepeatAtMs + repeatIntervalMs;
		if (now >= nextAt) {
			repeat.repeatCount++;
			repeat.lastRepeatAtMs = nextAt;
			result = true;
		}
	}

	repeat.lastFrameEvaluated = frameId;
	repeat.lastResult = result;
	return { result, repeat.repeatCount };
}

RawActionRepeatRecord& PlayerInput::ensureRawRepeatState(const std::string& action) {
	return m_rawActionRepeatRecords.try_emplace(action).first->second;
}

} // namespace bmsx
