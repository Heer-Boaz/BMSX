#include "machine/devices/input/controller.h"
#include "input/action_parser.h"
#include "input/player.h"

#include <stdexcept>

namespace bmsx {
namespace {

constexpr const char* INP_CONTEXT_ID = "inp_chip";
const InputControllerActionState EMPTY_ACTION_SNAPSHOT{};
const InputControllerActionState COMPLEX_QUERY_ACTION_SNAPSHOT{0u, 0u, 1u, 0u, 0.0, 0u};

} // namespace

InputController::InputController(Memory& memory, Input& input, const StringPool& strings)
	: m_memory(memory)
	, m_input(input)
	, m_strings(strings) {
	m_memory.mapIoWrite(IO_INP_PLAYER, this, &InputController::onRegisterWriteThunk);
	m_memory.mapIoWrite(IO_INP_ACTION, this, &InputController::onRegisterWriteThunk);
	m_memory.mapIoWrite(IO_INP_BIND, this, &InputController::onRegisterWriteThunk);
	m_memory.mapIoWrite(IO_INP_CTRL, this, &InputController::onRegisterWriteThunk);
	m_memory.mapIoWrite(IO_INP_QUERY, this, &InputController::onRegisterWriteThunk);
	m_memory.mapIoWrite(IO_INP_CONSUME, this, &InputController::onRegisterWriteThunk);
	m_memory.mapIoWrite(IO_INP_OUTPUT_INTENSITY_Q16, this, &InputController::onRegisterWriteThunk);
	m_memory.mapIoWrite(IO_INP_OUTPUT_DURATION_MS, this, &InputController::onRegisterWriteThunk);
	m_memory.mapIoRead(IO_INP_EVENT_STATUS, this, &InputController::onEventRegisterReadThunk);
	m_memory.mapIoRead(IO_INP_EVENT_COUNT, this, &InputController::onEventRegisterReadThunk);
	m_memory.mapIoRead(IO_INP_EVENT_PLAYER, this, &InputController::onEventRegisterReadThunk);
	m_memory.mapIoRead(IO_INP_EVENT_ACTION, this, &InputController::onEventRegisterReadThunk);
	m_memory.mapIoRead(IO_INP_EVENT_FLAGS, this, &InputController::onEventRegisterReadThunk);
	m_memory.mapIoRead(IO_INP_EVENT_VALUE, this, &InputController::onEventRegisterReadThunk);
	m_memory.mapIoRead(IO_INP_EVENT_REPEAT_COUNT, this, &InputController::onEventRegisterReadThunk);
	m_memory.mapIoRead(IO_INP_EVENT_CTRL, this, &InputController::onEventRegisterReadThunk);
	m_memory.mapIoWrite(IO_INP_EVENT_CTRL, this, &InputController::onEventCtrlWriteThunk);
	m_memory.mapIoRead(IO_INP_OUTPUT_STATUS, this, &InputController::onOutputRegisterReadThunk);
	m_memory.mapIoRead(IO_INP_OUTPUT_CTRL, this, &InputController::onOutputRegisterReadThunk);
	m_memory.mapIoWrite(IO_INP_OUTPUT_CTRL, this, &InputController::onOutputCtrlWriteThunk);
}

// disable-next-line single_line_method_pattern -- memory-map callbacks require a C-style thunk back into the input device instance.
void InputController::onRegisterWriteThunk(void* context, uint32_t addr, Value value) {
	static_cast<InputController*>(context)->onRegisterWrite(addr, value);
}

Value InputController::onEventRegisterReadThunk(void* context, uint32_t addr) {
	return static_cast<InputController*>(context)->onEventRegisterRead(addr);
}

// disable-next-line single_line_method_pattern -- memory-map callbacks require a C-style thunk back into the input device instance.
void InputController::onEventCtrlWriteThunk(void* context, uint32_t, Value value) {
	static_cast<InputController*>(context)->onEventCtrlWrite(toU32(value));
}

Value InputController::onOutputRegisterReadThunk(void* context, uint32_t addr) {
	return static_cast<InputController*>(context)->onOutputRegisterRead(addr);
}

// disable-next-line single_line_method_pattern -- memory-map callbacks require a C-style thunk back into the input device instance.
void InputController::onOutputCtrlWriteThunk(void* context, uint32_t, Value value) {
	static_cast<InputController*>(context)->onOutputCtrlWrite(toU32(value));
}

void InputController::reset() {
	m_sampleArmed = false;
	m_sampleSequence = 0;
	m_lastSampleCycle = 0;
	for (i32 playerIndex = 1; playerIndex <= INPUT_CONTROLLER_PLAYER_COUNT; playerIndex += 1) {
		PlayerChipState& state = m_playerStates[static_cast<size_t>(playerIndex - 1)];
		clearPlayerActions(playerIndex, state);
	}
	m_registers = InputControllerRegisterState{};
	m_eventFifo.clear();
	m_memory.writeIoValue(IO_INP_EVENT_CTRL, valueNumber(0.0));
	m_memory.writeIoValue(IO_INP_OUTPUT_CTRL, valueNumber(0.0));
	mirrorRegisters();
}

void InputController::cancelArmedSample() {
	m_sampleArmed = false;
}

void InputController::onVblankEdge(f64 currentTimeMs, u32 nowCycles) {
	if (!m_sampleArmed) {
		return;
	}
	m_sampleSequence += 1u;
	m_lastSampleCycle = nowCycles;
	m_input.samplePlayers(currentTimeMs);
	sampleCommittedActions();
	m_sampleArmed = false;
}

void InputController::onRegisterWrite(uint32_t addr, Value value) {
	switch (addr) {
		case IO_INP_PLAYER:
			m_registers.player = toU32(value);
			return;
		case IO_INP_ACTION:
			m_registers.actionStringId = asStringId(value);
			return;
		case IO_INP_BIND:
			m_registers.bindStringId = asStringId(value);
			return;
		case IO_INP_CTRL:
			onCtrlWrite(toU32(value));
			return;
		case IO_INP_QUERY:
			m_registers.queryStringId = asStringId(value);
			queryAction();
			return;
		case IO_INP_CONSUME:
			m_registers.consumeStringId = asStringId(value);
			consumeActions();
			return;
		case IO_INP_OUTPUT_INTENSITY_Q16:
			m_registers.outputIntensityQ16 = toU32(value);
			return;
		case IO_INP_OUTPUT_DURATION_MS:
			m_registers.outputDurationMs = toU32(value);
			return;
	}
}

void InputController::onCtrlWrite(u32 command) {
	m_registers.ctrl = command;
	switch (command) {
		case INP_CTRL_COMMIT:
			commitAction();
			return;
		case INP_CTRL_ARM:
			m_sampleArmed = true;
			return;
		case INP_CTRL_RESET:
			resetActions();
			return;
	}
}

Value InputController::onEventRegisterRead(uint32_t addr) const {
	switch (addr) {
		case IO_INP_EVENT_STATUS:
			return valueNumber(static_cast<double>(m_eventFifo.statusWord()));
		case IO_INP_EVENT_COUNT:
			return valueNumber(static_cast<double>(m_eventFifo.count()));
		case IO_INP_EVENT_PLAYER:
			return valueNumber(static_cast<double>(m_eventFifo.front().player));
		case IO_INP_EVENT_ACTION:
			return valueString(m_eventFifo.front().actionStringId);
		case IO_INP_EVENT_FLAGS:
			return valueNumber(static_cast<double>(m_eventFifo.front().statusWord));
		case IO_INP_EVENT_VALUE:
			return valueNumber(static_cast<double>(m_eventFifo.front().valueQ16));
		case IO_INP_EVENT_REPEAT_COUNT:
			return valueNumber(static_cast<double>(m_eventFifo.front().repeatCount));
		case IO_INP_EVENT_CTRL:
			return valueNumber(0.0);
	}
	throw std::runtime_error("ICU event register read is not mapped.");
}

void InputController::onEventCtrlWrite(u32 command) {
	switch (command) {
		case INP_EVENT_CTRL_POP:
			m_eventFifo.pop();
			break;
		case INP_EVENT_CTRL_CLEAR:
			m_eventFifo.clear();
			break;
	}
	m_memory.writeIoValue(IO_INP_EVENT_CTRL, valueNumber(0.0));
}

Value InputController::onOutputRegisterRead(uint32_t addr) const {
	switch (addr) {
		case IO_INP_OUTPUT_STATUS:
			return valueNumber(static_cast<double>(readOutputStatus()));
		case IO_INP_OUTPUT_CTRL:
			return valueNumber(0.0);
	}
	throw std::runtime_error("ICU output register read is not mapped.");
}

void InputController::onOutputCtrlWrite(u32 command) {
	switch (command) {
		case INP_OUTPUT_CTRL_APPLY:
			applyOutputEffect();
			break;
	}
	m_memory.writeIoValue(IO_INP_OUTPUT_CTRL, valueNumber(0.0));
}

void InputController::queryAction() {
	const std::string& queryText = m_strings.toString(m_registers.queryStringId);
	const PlayerChipState& state = m_playerStates[static_cast<size_t>(m_registers.player - 1u)];
	const bool triggered = ActionDefinitionEvaluator::checkActionTriggered(queryText,
		[this, &state](const std::string& actionName, std::optional<f64>) {
			return createSnapshotActionState(state, actionName);
		});
	if (!triggered) {
		writeResult(0u, 0u);
		return;
	}
	const InputControllerActionState& selectedAction = selectQuerySnapshotAction(state, queryText);
	writeResult(selectedAction.statusWord, selectedAction.valueQ16);
}

void InputController::consumeActions() {
	const std::string& actionNames = m_strings.toString(m_registers.consumeStringId);
	PlayerInput* const playerInput = m_input.getPlayerInput(static_cast<i32>(m_registers.player));
	PlayerChipState& state = m_playerStates[static_cast<size_t>(m_registers.player - 1u)];
	size_t start = 0;
	for (size_t index = 0; index <= actionNames.size(); index += 1) {
		if (index != actionNames.size() && actionNames[index] != ',') {
			continue;
		}
		const std::string actionName = actionNames.substr(start, index - start);
		playerInput->consumeAction(actionName);
		markSnapshotActionConsumed(state, actionName);
		start = index + 1;
	}
}

void InputController::commitAction() {
	const i32 playerIndex = static_cast<i32>(m_registers.player);
	PlayerChipState& state = m_playerStates[static_cast<size_t>(playerIndex - 1)];
	installActionMapping(state, m_registers.actionStringId, m_registers.bindStringId);
	upsertAction(state, m_registers.actionStringId, m_registers.bindStringId);
	PlayerInput* const playerInput = m_input.getPlayerInput(playerIndex);
	playerInput->pushContext(INP_CONTEXT_ID, state.keyboard, state.gamepad, {});
	state.contextPushed = true;
}

void InputController::resetActions() {
	const i32 playerIndex = static_cast<i32>(m_registers.player);
	PlayerChipState& state = m_playerStates[static_cast<size_t>(playerIndex - 1)];
	clearPlayerActions(playerIndex, state);
	writeResult(0u, 0u);
}

void InputController::clearPlayerActions(i32 playerIndex, PlayerChipState& state) {
	if (state.contextPushed) {
		m_input.getPlayerInput(playerIndex)->clearContext(INP_CONTEXT_ID);
	}
	state.keyboard.clear();
	state.gamepad.clear();
	state.actions.clear();
	state.contextPushed = false;
}

void InputController::restorePlayerActions(i32 playerIndex, PlayerChipState& state, const std::vector<InputControllerActionState>& actions) {
	for (const InputControllerActionState& action : actions) {
		installActionMapping(state, action.actionStringId, action.bindStringId);
		state.actions.push_back(action);
	}
	if (!state.actions.empty()) {
		m_input.getPlayerInput(playerIndex)->pushContext(INP_CONTEXT_ID, state.keyboard, state.gamepad, {});
		state.contextPushed = true;
	}
}

void InputController::installActionMapping(PlayerChipState& state, StringId actionStringId, StringId bindStringId) {
	const std::string& actionName = m_strings.toString(actionStringId);
	const std::string& bindingsText = m_strings.toString(bindStringId);
	std::vector<KeyboardBinding> keyboardBindings;
	std::vector<GamepadBinding> gamepadBindings;
	appendBindings(bindingsText, keyboardBindings, gamepadBindings);
	state.keyboard[actionName] = std::move(keyboardBindings);
	state.gamepad[actionName] = std::move(gamepadBindings);
}

void InputController::upsertAction(PlayerChipState& state, StringId actionStringId, StringId bindStringId) {
	for (InputControllerActionState& action : state.actions) {
		if (action.actionStringId == actionStringId) {
			action.bindStringId = bindStringId;
			action.statusWord = 0u;
			action.valueQ16 = 0u;
			action.pressTime = 0.0;
			action.repeatCount = 0u;
			return;
		}
	}
	state.actions.push_back(InputControllerActionState{ actionStringId, bindStringId });
}

void InputController::sampleCommittedActions() {
	for (i32 playerIndex = 1; playerIndex <= INPUT_CONTROLLER_PLAYER_COUNT; playerIndex += 1) {
		PlayerChipState& state = m_playerStates[static_cast<size_t>(playerIndex - 1)];
		PlayerInput* const playerInput = m_input.getPlayerInput(playerIndex);
		for (InputControllerActionState& action : state.actions) {
			const ActionState actionState = playerInput->getActionState(m_strings.toString(action.actionStringId));
			action.statusWord = packInputActionStatus(actionState);
			action.valueQ16 = encodeInputActionValueQ16(actionState);
			action.pressTime = buttonPressTimeOrZero(actionState);
			action.repeatCount = static_cast<u32>(actionRepeatCount(actionState));
			if ((action.statusWord & INP_EVENT_ACTION_STATUS_MASK) != 0u) {
				m_eventFifo.push(static_cast<u32>(playerIndex), action);
			}
		}
	}
}

u32 InputController::readOutputStatus() const {
	return m_input.getPlayerInput(static_cast<i32>(m_registers.player))->supportsVibrationEffect() ? INP_OUTPUT_STATUS_SUPPORTED : 0u;
}

void InputController::applyOutputEffect() {
	VibrationParams params;
	params.duration = static_cast<f64>(m_registers.outputDurationMs);
	params.intensity = decodeInputOutputIntensityQ16(m_registers.outputIntensityQ16);
	m_input.getPlayerInput(static_cast<i32>(m_registers.player))->applyVibrationEffect(params);
}

ActionState InputController::createSnapshotActionState(const PlayerChipState& state, const std::string& actionName) const {
	const InputControllerActionState& action = findSnapshotAction(state, actionName);
	return createInputActionSnapshot(actionName, action.statusWord, action.valueQ16, action.pressTime, action.repeatCount);
}

const InputControllerActionState& InputController::selectQuerySnapshotAction(const PlayerChipState& state, const std::string& queryText) const {
	const std::string* const actionName = ActionDefinitionEvaluator::getSimpleActionName(queryText);
	if (!actionName) {
		return COMPLEX_QUERY_ACTION_SNAPSHOT;
	}
	return findSnapshotAction(state, *actionName);
}

const InputControllerActionState& InputController::findSnapshotAction(const PlayerChipState& state, const std::string& actionName) const {
	for (const InputControllerActionState& action : state.actions) {
		if (m_strings.toString(action.actionStringId) == actionName) {
			return action;
		}
	}
	return EMPTY_ACTION_SNAPSHOT;
}

void InputController::markSnapshotActionConsumed(PlayerChipState& state, const std::string& actionName) {
	for (InputControllerActionState& action : state.actions) {
		if (m_strings.toString(action.actionStringId) == actionName) {
			action.statusWord |= INP_STATUS_CONSUMED;
			return;
		}
	}
}

void InputController::writeResult(u32 status, u32 value) {
	m_registers.status = status;
	m_registers.value = value;
	m_memory.writeIoValue(IO_INP_STATUS, valueNumber(static_cast<double>(status)));
	m_memory.writeIoValue(IO_INP_VALUE, valueNumber(static_cast<double>(value)));
}

void InputController::mirrorRegisters() {
	m_memory.writeIoValue(IO_INP_PLAYER, valueNumber(static_cast<double>(m_registers.player)));
	m_memory.writeIoValue(IO_INP_ACTION, valueString(m_registers.actionStringId));
	m_memory.writeIoValue(IO_INP_BIND, valueString(m_registers.bindStringId));
	m_memory.writeIoValue(IO_INP_CTRL, valueNumber(static_cast<double>(m_registers.ctrl)));
	m_memory.writeIoValue(IO_INP_QUERY, valueString(m_registers.queryStringId));
	m_memory.writeIoValue(IO_INP_STATUS, valueNumber(static_cast<double>(m_registers.status)));
	m_memory.writeIoValue(IO_INP_VALUE, valueNumber(static_cast<double>(m_registers.value)));
	m_memory.writeIoValue(IO_INP_CONSUME, valueString(m_registers.consumeStringId));
	m_memory.writeIoValue(IO_INP_OUTPUT_INTENSITY_Q16, valueNumber(static_cast<double>(m_registers.outputIntensityQ16)));
	m_memory.writeIoValue(IO_INP_OUTPUT_DURATION_MS, valueNumber(static_cast<double>(m_registers.outputDurationMs)));
}

void InputController::appendBindings(
	const std::string& bindingsText,
	std::vector<KeyboardBinding>& keyboardBindings,
	std::vector<GamepadBinding>& gamepadBindings
) const {
	const auto& defaultKeyboard = Input::DEFAULT_INPUT_MAPPING.keyboard;
	size_t start = 0;
	for (size_t index = 0; index <= bindingsText.size(); index += 1) {
		if (index != bindingsText.size() && bindingsText[index] != ',') {
			continue;
		}
		const std::string binding = bindingsText.substr(start, index - start);
		const auto keyboardIt = defaultKeyboard.find(binding);
		if (keyboardIt != defaultKeyboard.end()) {
			const std::vector<KeyboardBinding>& defaultBindings = keyboardIt->second;
			keyboardBindings.insert(keyboardBindings.end(), defaultBindings.begin(), defaultBindings.end());
		}
		gamepadBindings.push_back(GamepadBinding{ binding, std::nullopt });
		start = index + 1;
	}
}

} // namespace bmsx
