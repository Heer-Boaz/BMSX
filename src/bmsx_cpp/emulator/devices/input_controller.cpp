#include "input_controller.h"

namespace bmsx {
namespace {

constexpr const char* INP_CONTEXT_ID = "inp_chip";

} // namespace

InputController::InputController(Memory& memory, Input& input, const StringPool& strings)
	: m_memory(memory)
	, m_input(input)
	, m_strings(strings)
	, m_defaultInputMapping(Input::getDefaultInputMapping()) {
}

void InputController::reset() {
	for (i32 playerIndex = 1; playerIndex <= PLAYERS_MAX; playerIndex += 1) {
		PlayerChipState& state = playerState(playerIndex);
		if (state.contextPushed) {
			m_input.getPlayerInput(playerIndex)->popContext(INP_CONTEXT_ID);
		}
		state.keyboard.clear();
		state.gamepad.clear();
		state.contextPushed = false;
	}
	m_memory.writeValue(IO_INP_PLAYER, valueNumber(1.0));
	m_memory.writeValue(IO_INP_STATUS, valueNumber(0.0));
	m_memory.writeValue(IO_INP_VALUE, valueNumber(0.0));
}

void InputController::onCtrlWrite() {
	switch (toU32(asNumber(m_memory.readValue(IO_INP_CTRL)))) {
		case INP_CTRL_COMMIT:
			commitAction();
			return;
		case INP_CTRL_ARM:
			return;
		case INP_CTRL_RESET:
			resetActions();
			return;
	}
}

void InputController::onQueryWrite() {
	const Value queryValue = m_memory.readValue(IO_INP_QUERY);
	const std::string& queryText = m_strings.toString(asStringId(queryValue));
	PlayerInput* const playerInput = m_input.getPlayerInput(currentPlayerIndex());
	const bool triggered = playerInput->checkActionTriggered(queryText);
	m_memory.writeValue(IO_INP_STATUS, valueNumber(triggered ? 1.0 : 0.0));
	m_memory.writeValue(IO_INP_VALUE, valueNumber(0.0));
}

void InputController::onConsumeWrite() {
	const std::string& actionNames = m_strings.toString(asStringId(m_memory.readValue(IO_INP_CONSUME)));
	PlayerInput* const playerInput = m_input.getPlayerInput(currentPlayerIndex());
	size_t start = 0;
	for (size_t index = 0; index <= actionNames.size(); index += 1) {
		if (index != actionNames.size() && actionNames[index] != ',') {
			continue;
		}
		playerInput->consumeAction(actionNames.substr(start, index - start));
		start = index + 1;
	}
}

InputController::PlayerChipState& InputController::playerState(i32 playerIndex) {
	return m_playerStates[static_cast<size_t>(playerIndex - 1)];
}

const InputController::PlayerChipState& InputController::playerState(i32 playerIndex) const {
	return m_playerStates[static_cast<size_t>(playerIndex - 1)];
}

i32 InputController::currentPlayerIndex() const {
	return static_cast<i32>(std::floor(asNumber(m_memory.readValue(IO_INP_PLAYER))));
}

void InputController::commitAction() {
	const i32 playerIndex = currentPlayerIndex();
	PlayerChipState& state = playerState(playerIndex);
	const std::string& actionName = m_strings.toString(asStringId(m_memory.readValue(IO_INP_ACTION)));
	const std::string& bindingsText = m_strings.toString(asStringId(m_memory.readValue(IO_INP_BIND)));
	std::vector<KeyboardBinding> keyboardBindings;
	std::vector<GamepadBinding> gamepadBindings;
	appendBindings(bindingsText, keyboardBindings, gamepadBindings);
	state.keyboard[actionName] = std::move(keyboardBindings);
	state.gamepad[actionName] = std::move(gamepadBindings);
	PlayerInput* const playerInput = m_input.getPlayerInput(playerIndex);
	if (state.contextPushed) {
		playerInput->popContext(INP_CONTEXT_ID);
	}
	InputMap map;
	map.keyboard = state.keyboard;
	map.gamepad = state.gamepad;
	playerInput->pushContext(INP_CONTEXT_ID, 100, map);
	state.contextPushed = true;
}

void InputController::resetActions() {
	const i32 playerIndex = currentPlayerIndex();
	PlayerChipState& state = playerState(playerIndex);
	if (state.contextPushed) {
		m_input.getPlayerInput(playerIndex)->popContext(INP_CONTEXT_ID);
	}
	state.keyboard.clear();
	state.gamepad.clear();
	state.contextPushed = false;
	m_memory.writeValue(IO_INP_STATUS, valueNumber(0.0));
	m_memory.writeValue(IO_INP_VALUE, valueNumber(0.0));
}

void InputController::appendBindings(
	const std::string& bindingsText,
	std::vector<KeyboardBinding>& keyboardBindings,
	std::vector<GamepadBinding>& gamepadBindings
) const {
	size_t start = 0;
	for (size_t index = 0; index <= bindingsText.size(); index += 1) {
		if (index != bindingsText.size() && bindingsText[index] != ',') {
			continue;
		}
		const std::string binding = bindingsText.substr(start, index - start);
		const auto keyboardIt = m_defaultInputMapping.keyboard.find(binding);
		if (keyboardIt != m_defaultInputMapping.keyboard.end()) {
			const std::vector<KeyboardBinding>& defaultBindings = keyboardIt->second;
			keyboardBindings.insert(keyboardBindings.end(), defaultBindings.begin(), defaultBindings.end());
		}
		gamepadBindings.push_back(GamepadBinding{ binding, std::nullopt });
		start = index + 1;
	}
}

} // namespace bmsx
