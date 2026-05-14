#include "machine/devices/input/controller.h"
#include "input/player.h"

namespace bmsx {
namespace {

constexpr const char* INP_CONTEXT_ID = "inp_chip";

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
}

// disable-next-line single_line_method_pattern -- memory-map callbacks require a C-style thunk back into the input device instance.
void InputController::onRegisterWriteThunk(void* context, uint32_t addr, Value value) {
	static_cast<InputController*>(context)->onRegisterWrite(addr, value);
}

void InputController::reset() {
	m_sampleArmed = false;
	for (i32 playerIndex = 1; playerIndex <= PLAYERS_MAX; playerIndex += 1) {
		PlayerChipState& state = m_playerStates[static_cast<size_t>(playerIndex - 1)];
		clearPlayerActions(playerIndex, state);
	}
	m_registers = InputControllerRegisterState{};
	mirrorRegisters();
}

void InputController::cancelArmedSample() {
	m_sampleArmed = false;
}

void InputController::onVblankEdge() {
	if (!m_sampleArmed) {
		return;
	}
	m_input.beginFrame();
	m_sampleArmed = false;
}

InputControllerState InputController::captureState() const {
	InputControllerState state;
	state.sampleArmed = m_sampleArmed;
	state.registers = m_registers;
	for (size_t index = 0; index < m_playerStates.size(); index += 1) {
		state.players[index].actions = m_playerStates[index].actions;
	}
	return state;
}

void InputController::restoreState(const InputControllerState& state) {
	for (i32 playerIndex = 1; playerIndex <= PLAYERS_MAX; playerIndex += 1) {
		clearPlayerActions(playerIndex, m_playerStates[static_cast<size_t>(playerIndex - 1)]);
	}
	m_sampleArmed = state.sampleArmed;
	m_registers = state.registers;
	for (i32 playerIndex = 1; playerIndex <= PLAYERS_MAX; playerIndex += 1) {
		restorePlayerActions(
			playerIndex,
			m_playerStates[static_cast<size_t>(playerIndex - 1)],
			state.players[static_cast<size_t>(playerIndex - 1)].actions
		);
	}
	mirrorRegisters();
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

void InputController::queryAction() {
	const std::string& queryText = m_strings.toString(m_registers.queryStringId);
	PlayerInput* const playerInput = m_input.getPlayerInput(static_cast<i32>(m_registers.player));
	const bool triggered = playerInput->checkActionTriggered(queryText);
	writeResult(triggered ? 1u : 0u, 0u);
}

void InputController::consumeActions() {
	const std::string& actionNames = m_strings.toString(m_registers.consumeStringId);
	PlayerInput* const playerInput = m_input.getPlayerInput(static_cast<i32>(m_registers.player));
	size_t start = 0;
	for (size_t index = 0; index <= actionNames.size(); index += 1) {
		if (index != actionNames.size() && actionNames[index] != ',') {
			continue;
		}
		playerInput->consumeAction(actionNames.substr(start, index - start));
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
			return;
		}
	}
	state.actions.push_back(InputControllerActionState{ actionStringId, bindStringId });
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
