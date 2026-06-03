/*
 * keyboard.h - Keyboard input handler for BMSX
 */

#ifndef BMSX_KEYBOARDINPUT_H
#define BMSX_KEYBOARDINPUT_H

#include "models.h"
#include <unordered_map>
#include <unordered_set>

namespace bmsx {

/* ============================================================================
 * KeyboardInput
 *
 * Handles keyboard input, mapping key codes to button states.
 * Also maintains a shadow gamepad button state for unified handling.
 * ============================================================================ */

class KeyboardInput : public InputHandler {
public:
	// ─────────────────────────────────────────────────────────────────────────
	// Constructor
	// ─────────────────────────────────────────────────────────────────────────
	explicit KeyboardInput(const std::string& deviceId = "keyboard:0");
	~KeyboardInput() override = default;
	
	// ─────────────────────────────────────────────────────────────────────────
	// InputHandler interface
	// ─────────────────────────────────────────────────────────────────────────
	
	void pollInput() override;
	ButtonState getButtonState(const ButtonId& button) override;
	void consumeButton(const ButtonId& button) override;
	void reset(const std::vector<std::string>* except = nullptr) override;
	i32 gamepadIndex() const override { return 0; }
	bool supportsVibrationEffect() const override { return false; }
	void applyVibrationEffect(const VibrationParams& /*params*/) override {}
	
	// ─────────────────────────────────────────────────────────────────────────
	// Key events
	// ─────────────────────────────────────────────────────────────────────────
	
	// Called when a key is pressed
	void keydown(const std::string& keyCode, i32 pressId, f64 timestamp);
	
	// Called when a key is released
	void keyup(const std::string& keyCode, i32 pressId, f64 timestamp);
	
	// ─────────────────────────────────────────────────────────────────────────
	// State access
	// ─────────────────────────────────────────────────────────────────────────
	
	// Direct access to key states (for advanced queries)
	const std::unordered_map<std::string, ButtonState>& keyStates() const { return m_keyStates; }
	
private:
	std::string m_deviceId;
	
	// Raw key states (direct keyboard key codes)
	std::unordered_map<std::string, ButtonState> m_keyStates;
	std::unordered_set<std::string> m_pendingPresses;
	std::unordered_set<std::string> m_pendingReleases;

	// Mapped gamepad button states (for unified handling)
	std::unordered_map<std::string, ButtonState> m_gamepadButtonStates;
	
	// Press ID counter
	i32 m_nextPressId = 1;
	
	// Current time (updated during poll)
	f64 m_currentTimeMs = 0.0;
};

} // namespace bmsx

#endif // BMSX_KEYBOARDINPUT_H
