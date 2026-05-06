#pragma once

#include "machine/memory/memory.h"
#include "input/manager.h"
#include <array>
#include <string>

namespace bmsx {

struct InputControllerState {
	bool sampleArmed = false;
};

class InputController {
public:
	InputController(Memory& memory, Input& input, const StringPool& strings);

	void reset();
	void onCtrlWrite();
	void onQueryWrite();
	void onConsumeWrite();
	void onVblankEdge();
	InputControllerState captureState() const;
	void restoreState(const InputControllerState& state);
	bool sampleArmed = false;

private:
	static void onCtrlWriteThunk(void* context, uint32_t addr, Value value);
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
	std::array<PlayerChipState, PLAYERS_MAX> m_playerStates;

	void commitAction();
	void resetActions();
	void clearPlayerActions(i32 playerIndex, PlayerChipState& state);
	void appendBindings(const std::string& bindingsText, std::vector<KeyboardBinding>& keyboardBindings, std::vector<GamepadBinding>& gamepadBindings) const;
};

} // namespace bmsx
