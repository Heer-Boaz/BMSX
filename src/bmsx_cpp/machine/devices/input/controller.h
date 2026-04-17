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
	bool sampleArmed() const { return m_sampleArmed; }
	void restoreSampleArmed(bool armed) { m_sampleArmed = armed; }
	InputControllerState captureState() const;
	void restoreState(const InputControllerState& state);

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
	const InputMap m_defaultInputMapping;
	std::array<PlayerChipState, PLAYERS_MAX> m_playerStates;
	bool m_sampleArmed = false;

	PlayerChipState& playerState(i32 playerIndex);
	const PlayerChipState& playerState(i32 playerIndex) const;
	i32 currentPlayerIndex() const;
	void commitAction();
	void resetActions();
	void appendBindings(const std::string& bindingsText, std::vector<KeyboardBinding>& keyboardBindings, std::vector<GamepadBinding>& gamepadBindings) const;
};

} // namespace bmsx
