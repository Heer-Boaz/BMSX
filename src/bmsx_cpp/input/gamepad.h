/*
 * gamepad.h - Gamepad input handler for BMSX
 */

#ifndef BMSX_GAMEPADINPUT_H
#define BMSX_GAMEPADINPUT_H

#include "models.h"
#include <unordered_map>

namespace bmsx {

/* ============================================================================
 * GamepadInput
 *
 * Handles gamepad input, including button states and analog axis values.
 * Supports vibration effects on compatible hardware.
 * ============================================================================ */

class GamepadInput : public InputHandler {
public:
	// ─────────────────────────────────────────────────────────────────────────
	// Constructor
	// ─────────────────────────────────────────────────────────────────────────
	GamepadInput(const std::string& deviceId, const std::string& description = "");
	~GamepadInput() override;
	
	// ─────────────────────────────────────────────────────────────────────────
	// InputHandler interface
	// ─────────────────────────────────────────────────────────────────────────
	
	void pollInput() override;
	ButtonState getButtonState(const ButtonId& button) override;
	void consumeButton(const ButtonId& button) override;
	void reset(const std::vector<std::string>* except = nullptr) override;
	i32 gamepadIndex() const override;
	bool supportsVibrationEffect() const override;
	void applyVibrationEffect(const VibrationParams& params) override;
	void dispose() override;
	
	// ─────────────────────────────────────────────────────────────────────────
	// Button/Axis ingestion (from platform layer)
	// ─────────────────────────────────────────────────────────────────────────
	
	// Ingest a button press/release
	void ingestButton(const std::string& code, bool down, f32 value, 
						f64 timestamp, std::optional<i32> pressId = std::nullopt);
	
	// Ingest 2D axis values (for sticks)
	void ingestAxis2(const std::string& code, f32 x, f32 y, f64 timestamp);
	
	// ─────────────────────────────────────────────────────────────────────────
	// Device info
	// ─────────────────────────────────────────────────────────────────────────
	
	const std::string& deviceId() const { return m_deviceId; }
	const std::string& description() const { return m_description; }
	
	// ─────────────────────────────────────────────────────────────────────────
	// Vibration support
	// ─────────────────────────────────────────────────────────────────────────
	
	// Set whether vibration is supported
	void setVibrationSupported(bool supported) { m_vibrationSupported = supported; }
	
	// Callback type for vibration effects
	using VibrationCallback = std::function<void(f32 intensity, f64 duration)>;
	
	// Set callback for vibration effects (platform-specific implementation)
	void setVibrationCallback(VibrationCallback callback) { m_vibrationCallback = std::move(callback); }
	
private:
	std::string m_deviceId;
	std::string m_description;
	
	// Button states
	std::unordered_map<std::string, ButtonState> m_buttonStates;
	
	// Press ID counter
	i32 m_nextPressId = 1;
	
	// Last poll time
	f64 m_lastPollTimeMs = 0.0;
	
	// Vibration support
	bool m_vibrationSupported = false;
	VibrationCallback m_vibrationCallback;
};

} // namespace bmsx

#endif // BMSX_GAMEPADINPUT_H
