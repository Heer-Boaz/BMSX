#pragma once

#include "machine/memory/memory.h"
#include "input/input.h"
#include <array>
#include <string>

namespace bmsx {

class InputController {
public:
	InputController(Memory& memory, Input& input, const StringPool& strings);

	void reset();
	void onCtrlWrite();
	void onQueryWrite();
	void onConsumeWrite();

private:
	static void onQueryWriteThunk(void* context, uint32_t addr, Value value);
	static void onConsumeWriteThunk(void* context, uint32_t addr, Value value);

	struct PlayerChipState {
		KeyboardInputMapping keyboard;
		GamepadInputMapping gamepad;
		bool contextPushed = false;
	};

	Memory& m_memory;
	Input& m_input;
	const StringPool& m_strings;
	const InputMap m_defaultInputMapping;
	std::array<PlayerChipState, PLAYERS_MAX> m_playerStates;

	PlayerChipState& playerState(i32 playerIndex);
	const PlayerChipState& playerState(i32 playerIndex) const;
	i32 currentPlayerIndex() const;
	void commitAction();
	void resetActions();
	void appendBindings(const std::string& bindingsText, std::vector<KeyboardBinding>& keyboardBindings, std::vector<GamepadBinding>& gamepadBindings) const;
};

} // namespace bmsx
